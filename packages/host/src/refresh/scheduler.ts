import type { CompositeItem, FetchResult, FetchResults, Source } from "@opsdash/plugin-sdk";
import type { ResolvedConfig, WidgetInstance } from "../config/resolve.ts";
import type { Logger } from "../log.ts";
import { type ContextDeps, createActionContext, createContext, pluginLevelSettings } from "../plugins/context.ts";
import type { PluginRegistry } from "../plugins/registry.ts";
import type { Redactor } from "../secrets/redact.ts";
import type { Repos } from "../store/repos.ts";
import { ResultCache } from "./cache.ts";
import { type Consumer, type Need, planBatches, widgetConsumer } from "./plan.ts";
import type { ItemState, WidgetData, WidgetItem } from "./types.ts";

export interface SchedulerDeps {
  registry: PluginRegistry;
  repos: Repos;
  redactor: Redactor;
  log: Logger;
  mock: boolean;
  context: ContextDeps;
  resolved: () => ResolvedConfig;
  /** Widget paths visible to at least one connected viewer. */
  visiblePaths: () => Set<string>;
  publish: (data: WidgetData) => void;
}

type ChunkOutcome = { ok: FetchResults } | { failed: string; timeout: boolean };

/** Latest known result for one ref of one plugin (per batch key), shared by every widget that shows it. */
interface ItemResult {
  result?: FetchResult;
  state: ItemState;
  error?: string;
  lastSuccessAt?: number;
}

class TimeoutError extends Error {}

function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TimeoutError("Timed out waiting for the source"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

const isTimeout = (err: unknown) =>
  err instanceof TimeoutError || (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";

/**
 * One shared, server-side refresh cycle per plugin (FR-022 to FR-027): batched, de-duplicated, cached, never
 * overlapping, with failures isolated to the widgets that need the failed refs. Plugin API 1.1 adds composite
 * widgets (their refs join the owning plugins' batches), `ctx.scheduleNext`, and rate-limit back-off.
 */
export class Scheduler {
  readonly cache = new ResultCache();
  /** Plugins whose most recent refresh had failures (reported by /healthz). */
  readonly failing = new Set<string>();
  #deps: SchedulerDeps;
  #timers = new Map<string, NodeJS.Timeout>();
  #timersEnabled = false;
  #inFlight = new Set<string>();
  #pending = new Map<string, Set<string> | "all">();
  #latest = new Map<string, WidgetData>();
  #lastGood = new Map<string, WidgetData>();
  #items = new Map<string, ItemResult>();
  #running = new Set<Promise<void>>();
  #assembling = new Map<string, Promise<void>>();
  /** Plugins whose next scheduled run was requested through `ctx.scheduleNext`: that run bypasses the cache. */
  #fresh = new Set<string>();
  /** Last scheduled delay per plugin (tests and diagnostics). */
  readonly nextDelay = new Map<string, number>();

  constructor(deps: SchedulerDeps) {
    this.#deps = deps;
  }

  get contextDeps(): ContextDeps {
    return this.#deps.context;
  }

  latest(path: string): WidgetData | undefined {
    return this.#latest.get(path);
  }

  /** (Re)creates one timer chain per configured plugin at its effective interval. */
  reconfigure(): void {
    this.stop();
    this.#timersEnabled = true;
    for (const runtime of this.#deps.resolved().plugins.values()) this.#schedule(runtime.id, runtime.refreshInterval);
  }

  stop(): void {
    this.#timersEnabled = false;
    for (const t of this.#timers.values()) clearTimeout(t);
    this.#timers.clear();
  }

  #schedule(pluginId: string, delay: number): void {
    this.nextDelay.set(pluginId, delay);
    if (!this.#timersEnabled) return;
    clearTimeout(this.#timers.get(pluginId));
    const timer = setTimeout(() => {
      this.#timers.delete(pluginId);
      void this.tick(pluginId);
    }, delay);
    timer.unref();
    this.#timers.set(pluginId, timer);
  }

  /** Waits for every in-flight run and composite assembly (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.#running.size > 0 || this.#assembling.size > 0) {
      await Promise.allSettled([...this.#running, ...this.#assembling.values()]);
    }
  }

  /** Scheduled tick: skipped while the previous run for the plugin is still in flight (FR-026). */
  tick(pluginId: string): Promise<void> {
    if (this.#inFlight.has(pluginId)) {
      this.#deps.log.info({ event: "refresh.skipped", plugin: pluginId }, "Previous refresh still running");
      return Promise.resolve();
    }
    return this.#start(pluginId, undefined, true);
  }

  /**
   * Immediate run for specific widget paths (newly visible widgets, track/untrack, actions, config changes).
   * A composite widget's path runs each plugin that owns refs in it (API 1.1).
   */
  runPaths(paths: Iterable<string>): Promise<void> {
    const byPlugin = new Map<string, Set<string>>();
    const { widgets } = this.#deps.resolved();
    const add = (pluginId: string, p: string) => byPlugin.set(pluginId, (byPlugin.get(pluginId) ?? new Set()).add(p));
    const composites: string[] = [];
    for (const p of paths) {
      const w = widgets.get(p);
      if (!w) continue;
      if (this.#deps.registry.isComposite(w.pluginId)) {
        composites.push(p);
        for (const owner of new Set(this.#deps.repos.listRefs(p).map((r) => r.pluginId))) add(owner, p);
      } else add(w.pluginId, p);
    }
    const runs: Promise<void>[] = composites.map((p) => this.refreshComposite(p));
    for (const [pluginId, set] of byPlugin) {
      if (this.#inFlight.has(pluginId)) {
        const pending = this.#pending.get(pluginId);
        if (pending !== "all") this.#pending.set(pluginId, new Set([...(pending ?? []), ...set]));
      } else runs.push(this.#start(pluginId, set, false));
    }
    return Promise.all(runs).then(() => undefined);
  }

  #start(pluginId: string, paths: Set<string> | undefined, scheduled: boolean): Promise<void> {
    const run = this.#run(pluginId, paths, scheduled).finally(() => {
      this.#running.delete(run);
      const pending = this.#pending.get(pluginId);
      this.#pending.delete(pluginId);
      if (pending) void this.#start(pluginId, pending === "all" ? undefined : pending, false);
    });
    this.#running.add(run);
    return run;
  }

  #emit(data: WidgetData) {
    this.#latest.set(data.path, data);
    this.#deps.publish(data);
  }

  #fail(w: WidgetInstance, error: string, timeout: boolean) {
    const prev = this.#lastGood.get(w.path);
    if (prev) {
      this.#emit({
        path: w.path,
        state: "stale",
        items: prev.items,
        lastSuccessAt: prev.fetchedAt,
        fetchedAt: Date.now(),
        error,
      });
    } else {
      this.#emit({ path: w.path, state: timeout ? "timeout" : "error", items: [], fetchedAt: Date.now(), error });
    }
  }

  #setItem(key: string, update: { result?: FetchResult; failed?: string; timeout?: boolean }, now: number) {
    if (update.result) {
      const ok = "data" in update.result;
      const prev = this.#items.get(key);
      this.#items.set(key, {
        result: update.result,
        state: ok ? "ok" : "error",
        error: ok ? undefined : (update.result as { error: string }).error,
        lastSuccessAt: ok ? now : prev?.lastSuccessAt,
      });
      return;
    }
    const prev = this.#items.get(key);
    if (prev?.result && "data" in prev.result) {
      this.#items.set(key, { ...prev, state: "stale", error: update.failed });
    } else {
      this.#items.set(key, { state: update.timeout ? "timeout" : "error", error: update.failed });
    }
  }

  /** Visible composite widgets whose manifest composes this plugin (or all visible composites). */
  #compositeWidgets(pluginId?: string, paths?: Set<string>): WidgetInstance[] {
    const { registry } = this.#deps;
    const visible = this.#deps.visiblePaths();
    return [...this.#deps.resolved().widgets.values()].filter((w) => {
      if (w.status !== "ok" || !visible.has(w.path) || (paths && !paths.has(w.path))) return false;
      const composes = registry.get(w.pluginId)?.manifest?.composes;
      return Boolean(composes && (!pluginId || composes.includes(pluginId)));
    });
  }

  async #run(pluginId: string, paths: Set<string> | undefined, scheduled: boolean): Promise<void> {
    const { registry, repos, redactor, log, mock } = this.#deps;
    const resolved = this.#deps.resolved();
    const runtime = resolved.plugins.get(pluginId);
    const record = registry.get(pluginId);
    if (!runtime || !record?.module || record.manifest?.composes) return;
    const visible = this.#deps.visiblePaths();
    const widgets = [...resolved.widgets.values()].filter(
      (w) => w.pluginId === pluginId && w.status === "ok" && visible.has(w.path) && (!paths || paths.has(w.path)),
    );
    const composites = this.#compositeWidgets(pluginId, paths);
    const plugin = record.module;

    let requested: number | undefined;
    let backoff: number | undefined;
    const reschedule = () => {
      if (!scheduled && requested === undefined && backoff === undefined) return;
      const base = Math.min(requested ?? runtime.refreshInterval, runtime.refreshInterval);
      // A plugin asked to look again sooner (for example a running build): that look must reach the source.
      if (requested !== undefined && backoff === undefined) this.#fresh.add(pluginId);
      else this.#fresh.delete(pluginId);
      this.#schedule(pluginId, backoff !== undefined ? Math.max(backoff, base) : base);
    };

    if (widgets.length === 0 && composites.length === 0) {
      reschedule();
      return;
    }

    const consumers: Consumer[] = widgets.map((w) => widgetConsumer(plugin, w, (p) => repos.listRefs(p)));
    let foreignSettings: unknown;
    try {
      if (composites.length > 0) foreignSettings = pluginLevelSettings(this.#deps.context, pluginId);
    } catch {}
    const compositeConsumers: Consumer[] = [];
    if (foreignSettings !== undefined) {
      for (const c of composites) {
        const refs = repos
          .listRefs(c.path)
          .filter((r) => r.pluginId === pluginId)
          .map((r) => r.ref);
        if (refs.length > 0) compositeConsumers.push({ path: c.path, settings: foreignSettings, refs });
      }
    }

    if (runtime.issues.length > 0) {
      const message = runtime.issues.join("; ");
      for (const w of widgets) this.#fail(w, message, false);
      const now = Date.now();
      for (const c of compositeConsumers) {
        for (const ref of c.refs) {
          const bk = plugin.batchKey?.(c.settings, ref) ?? "default";
          this.#setItem(ResultCache.key(pluginId, bk, plugin.refKey(ref)), { failed: message }, now);
        }
      }
      await this.#assembleAll(composites);
      reschedule();
      return;
    }

    this.#inFlight.add(pluginId);
    const started = Date.now();
    const source = (mock ? plugin.mock : plugin) as Source<unknown, unknown>;
    try {
      const bypassCache = scheduled && this.#fresh.has(pluginId);
      this.#fresh.delete(pluginId);
      const plan = planBatches(
        pluginId,
        plugin,
        [...consumers, ...compositeConsumers],
        bypassCache ? new ResultCache() : this.cache,
        record.manifest?.maxBatchSize,
      );
      const outcomes = new Map<string, ChunkOutcome>(); // batchKey|refKey -> outcome
      let requests = 0;
      let failures = 0;

      await Promise.all(
        plan.groups.flatMap((group) =>
          group.chunks.map(async (chunk) => {
            requests++;
            const ctx = createContext(this.#deps.context, pluginId, {
              settings: group.settings,
              timeoutMs: runtime.timeout,
              allowedEnv: record.manifest!.env,
              mockFaults: runtime.mockFaults,
              onScheduleNext: (ms) => {
                requested = requested === undefined ? ms : Math.min(requested, ms);
              },
            });
            let outcome: ChunkOutcome;
            try {
              const res = await withSignal(
                Promise.resolve(
                  source.fetch(
                    chunk.map((n) => n.ref),
                    ctx,
                  ),
                ),
                ctx.signal,
              );
              const map: FetchResults = res instanceof Map ? res : new Map(Object.entries(res as object));
              outcome = { ok: map };
              const wanted = new Set(chunk.map((n) => n.refKey));
              for (const key of map.keys()) {
                if (!wanted.has(key)) {
                  log.debug(
                    { event: "refresh.unrequested", plugin: pluginId, refKey: key },
                    "Ignoring result that was not requested",
                  );
                }
              }
              for (const n of chunk) {
                const r = map.get(n.refKey);
                if (r && "data" in r)
                  this.cache.set(ResultCache.key(pluginId, group.batchKey, n.refKey), r, runtime.cacheWindow);
              }
            } catch (err) {
              failures++;
              const timeout = isTimeout(err);
              const retryAfterMs = (err as { retryAfterMs?: number }).retryAfterMs;
              if (typeof retryAfterMs === "number") backoff = Math.max(backoff ?? 0, retryAfterMs);
              const message = redactor.string(timeout ? "Timed out waiting for the source" : (err as Error).message);
              log.warn(
                { event: "refresh.failed", plugin: pluginId, timeout, retryAfterMs, error: message },
                "Plugin fetch failed",
              );
              outcome = { failed: message, timeout };
            }
            for (const n of chunk) outcomes.set(`${group.batchKey}|${n.refKey}`, outcome);
          }),
        ),
      );

      const now = Date.now();
      const resultFor = (n: Need): { result?: FetchResult; failed?: { failed: string; timeout: boolean } } => {
        const cached = plan.cached.get(ResultCache.key(pluginId, n.batchKey, n.refKey));
        if (cached) return { result: cached };
        const outcome = outcomes.get(`${n.batchKey}|${n.refKey}`);
        if (outcome && "failed" in outcome) return { failed: outcome };
        if (outcome && "ok" in outcome) {
          return { result: outcome.ok.get(n.refKey) ?? { error: `No result returned for ${n.refKey}` } };
        }
        return { result: { error: `No result returned for ${n.refKey}` } };
      };

      // Shared per-item results (composite widgets read these).
      const seen = new Set<string>();
      for (const needs of plan.needs.values()) {
        for (const n of needs) {
          const key = ResultCache.key(pluginId, n.batchKey, n.refKey);
          if (seen.has(key)) continue;
          seen.add(key);
          const r = resultFor(n);
          const result = r.result && "error" in r.result ? { error: redactor.string(r.result.error) } : r.result;
          this.#setItem(key, result ? { result } : { failed: r.failed!.failed, timeout: r.failed!.timeout }, now);
        }
      }

      for (const w of widgets) {
        const needs = plan.needs.get(w.path) ?? [];
        if (needs.length === 0) {
          this.#emit({ path: w.path, state: "empty", items: [], fetchedAt: now });
          continue;
        }
        const failed: Array<{ failed: string; timeout: boolean }> = [];
        const items: WidgetItem[] = needs.map((n) => {
          const r = resultFor(n);
          if (r.failed) {
            failed.push(r.failed);
            return { plugin: pluginId, refKey: n.refKey, ref: n.ref, error: r.failed.failed };
          }
          const result = r.result!;
          return "data" in result
            ? { plugin: pluginId, refKey: n.refKey, ref: n.ref, data: result.data }
            : { plugin: pluginId, refKey: n.refKey, ref: n.ref, error: redactor.string(result.error) };
        });
        if (failed.length === needs.length) {
          this.#fail(
            w,
            failed[0]!.failed,
            failed.every((f) => f.timeout),
          );
          continue;
        }
        const data: WidgetData = { path: w.path, state: "ok", items, fetchedAt: now, lastSuccessAt: now };
        this.#lastGood.set(w.path, data);
        this.#emit(data);
      }

      if (failures > 0) this.failing.add(pluginId);
      else this.failing.delete(pluginId);
      log.info(
        {
          event: "refresh.cycle",
          plugin: pluginId,
          requests,
          refs: plan.groups.reduce((n, g) => n + g.uniqueRefs, 0),
          cached: plan.cached.size,
          widgets: widgets.length + compositeConsumers.length,
          durationMs: Date.now() - started,
          failures,
          ...(requested !== undefined ? { nextInMs: requested } : {}),
        },
        "Refresh cycle",
      );
    } catch (err) {
      const message = redactor.string((err as Error).message);
      this.failing.add(pluginId);
      log.error({ event: "refresh.error", plugin: pluginId, error: message }, "Refresh failed");
      for (const w of widgets) this.#fail(w, message, false);
    } finally {
      this.#inFlight.delete(pluginId);
    }
    await this.#assembleAll(composites);
    reschedule();
  }

  async #assembleAll(composites: WidgetInstance[]): Promise<void> {
    await Promise.all(composites.map((c) => this.refreshComposite(c.path)));
  }

  /**
   * Assembles and publishes a composite widget's data from the latest per-item results, without fetching
   * (API 1.1): used after contributing runs, on subscribe, for empty widgets and right after actions.
   */
  refreshComposite(path: string): Promise<void> {
    const prev = this.#assembling.get(path) ?? Promise.resolve();
    const next = prev
      .then(() => this.#assemble(path))
      .catch((err) => {
        this.#deps.log.error(
          { event: "composite.error", path, error: this.#deps.redactor.string((err as Error).message) },
          "Composite assembly failed",
        );
      })
      .finally(() => {
        if (this.#assembling.get(path) === next) this.#assembling.delete(path);
      });
    this.#assembling.set(path, next);
    return next;
  }

  #compositeItems(path: string): { items: CompositeItem[]; links: Array<{ from: number; to: number }> } {
    const { repos, registry } = this.#deps;
    const settingsCache = new Map<string, unknown>();
    const items: CompositeItem[] = repos.listRefs(path).map((r) => {
      const owner = registry.get(r.pluginId)?.module;
      const base = { plugin: r.pluginId, id: r.id, refKey: r.refKey, ref: r.ref };
      if (!owner) return { ...base, state: "error", error: `plugin ${r.pluginId} is not installed` };
      if (!settingsCache.has(r.pluginId)) {
        try {
          settingsCache.set(r.pluginId, pluginLevelSettings(this.#deps.context, r.pluginId));
        } catch (err) {
          settingsCache.set(r.pluginId, err);
        }
      }
      const settings = settingsCache.get(r.pluginId);
      if (settings instanceof Error) return { ...base, state: "error", error: settings.message };
      const key = ResultCache.key(r.pluginId, owner.batchKey?.(settings, r.ref) ?? "default", r.refKey);
      const item = this.#items.get(key);
      if (!item) return { ...base, state: "loading" };
      const data = item.result && "data" in item.result ? item.result.data : undefined;
      return {
        ...base,
        ...(data !== undefined ? { data } : {}),
        ...(item.error ? { error: item.error } : {}),
        state: item.state,
        ...(item.lastSuccessAt ? { lastSuccessAt: item.lastSuccessAt } : {}),
      };
    });
    return { items, links: repos.listLinksForWidget(path) };
  }

  async #assemble(path: string): Promise<void> {
    const w = this.#deps.resolved().widgets.get(path);
    const record = w && this.#deps.registry.get(w.pluginId);
    if (!w || !record?.module || !record.manifest?.composes) return;
    let { items, links } = this.#compositeItems(path);
    let meta: unknown;
    const onData = record.module.onData;
    if (onData) {
      const runtime = this.#deps.resolved().plugins.get(w.pluginId);
      const ctx = createActionContext(
        this.#deps.context,
        w.pluginId,
        { path, settings: w.settings },
        {
          timeoutMs: runtime?.timeout ?? 10_000,
          allowedEnv: record.manifest.env,
          mockFaults: runtime?.mockFaults,
        },
      );
      const before = items.length;
      const out = await onData({ path, items, links }, ctx);
      meta = out?.meta;
      const after = this.#compositeItems(path);
      if (after.items.length !== before) ({ items, links } = after);
    }
    const loading = items.length > 0 && items.every((i) => i.state === "loading");
    const lastSuccess = Math.max(0, ...items.map((i) => i.lastSuccessAt ?? 0));
    this.#emit({
      path,
      state: items.length === 0 ? "empty" : loading ? "loading" : "ok",
      items: items as WidgetItem[],
      links,
      meta,
      fetchedAt: Date.now(),
      ...(lastSuccess > 0 ? { lastSuccessAt: lastSuccess } : {}),
    });
  }
}

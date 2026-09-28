import {
  type ActionContext,
  type MockContextFaults,
  type PluginContext,
  ResolverError,
  type StoredRef,
} from "@opsdash/plugin-sdk";
import type { ResolvedConfig } from "../config/resolve.ts";
import type { Logger } from "../log.ts";
import type { Redactor } from "../secrets/redact.ts";
import type { Repos } from "../store/repos.ts";
import type { PluginRegistry } from "./registry.ts";

export interface ContextDeps {
  repos: Repos;
  env: Map<string, string>;
  redactor: Redactor;
  log: Logger;
  mock: boolean;
  /** API 1.1 (cross-plugin calls); set by the server. */
  registry?: PluginRegistry;
  resolved?: () => ResolvedConfig;
}

export class MissingSecretError extends Error {}

export interface ContextOptions<S> {
  settings: S;
  timeoutMs: number;
  allowedEnv: string[];
  mockFaults?: MockContextFaults;
  /** Receives `ctx.scheduleNext(ms)` requests (the scheduler collects them per run). */
  onScheduleNext?: (ms: number) => void;
}

/** Plugin-level settings of a plugin, validated through its own schema (used for foreign refs and resolvers). */
export function pluginLevelSettings(deps: ContextDeps, pluginId: string): unknown {
  const record = deps.registry?.get(pluginId);
  if (!record?.module) throw new ResolverError(`Plugin "${pluginId}" is not installed`);
  const raw = deps.resolved?.().set.plugins[pluginId]?.value.settings ?? {};
  const parsed = record.module.settings.safeParse(raw);
  if (!parsed.success) throw new ResolverError(`Plugin "${pluginId}" has invalid settings`);
  return parsed.data;
}

/** Builds the context for calling another plugin's code with that plugin's own settings, secrets and state. */
function targetContext(deps: ContextDeps, targetId: string): PluginContext {
  const record = deps.registry?.get(targetId);
  if (!record?.module || !record.manifest) throw new ResolverError(`Plugin "${targetId}" is not installed`);
  const runtime = deps.resolved?.().plugins.get(targetId);
  return createContext(deps, targetId, {
    settings: pluginLevelSettings(deps, targetId),
    timeoutMs: runtime?.timeout ?? 10_000,
    allowedEnv: record.manifest.env,
    mockFaults: runtime?.mockFaults,
  });
}

/** Builds the sandboxed context handed to plugin code; everything is scoped to the calling plugin. */
export function createContext<S>(deps: ContextDeps, pluginId: string, opts: ContextOptions<S>): PluginContext<S> {
  const { repos } = deps;
  return {
    settings: opts.settings,
    signal: AbortSignal.timeout(opts.timeoutMs),
    log: deps.log.child({ plugin: pluginId }),
    mock: deps.mock,
    mockFaults: opts.mockFaults ?? {},
    scheduleNext: (ms) => {
      if (Number.isFinite(ms) && ms >= 0) opts.onScheduleNext?.(ms);
    },
    plugins: {
      async parse(targetId, input) {
        const ctx = targetContext(deps, targetId);
        const plugin = deps.registry!.get(targetId)!.module!;
        const source = deps.mock ? plugin.mock : plugin;
        if (typeof source?.parseReference !== "function")
          throw new ResolverError(`Plugin "${targetId}" cannot parse input`);
        return source.parseReference(input, ctx);
      },
      async resolve(targetId, name, input) {
        const ctx = targetContext(deps, targetId);
        const plugin = deps.registry!.get(targetId)!.module!;
        const resolver = (deps.mock ? plugin.mock?.resolvers : plugin.resolvers)?.[name];
        if (typeof resolver !== "function") throw new ResolverError(`Plugin "${targetId}" has no resolver "${name}"`);
        return resolver(input, ctx);
      },
    },
    secrets: {
      get(name) {
        if (!opts.allowedEnv.includes(name)) {
          throw new Error(`Plugin "${pluginId}" did not declare environment variable ${name} in its manifest`);
        }
        const value = deps.env.get(name);
        if (value === undefined) throw new MissingSecretError(`${name} missing for plugin ${pluginId}`);
        deps.redactor.register(value);
        return value;
      },
    },
    state: {
      get: <T>(key: string) => repos.stateGet(pluginId, key) as T | undefined,
      set: (key, value) => repos.stateSet(pluginId, key, value),
      delete: (key) => repos.stateDelete(pluginId, key),
      list: () => repos.stateList(pluginId),
    },
    refs: { find: (otherPlugin, refKey) => repos.findRef(otherPlugin, refKey) },
    links: {
      create: (from, to) => repos.createLink(from, to, pluginId),
      remove: (from, to) => repos.removeLink(from, to),
      list: (refId) => repos.listLinks(refId),
    },
  };
}

/**
 * Context for widget actions and `onData` (API 1.1): the plugin context plus `ctx.widget`, which can change
 * only Opsdash's own store, and only for this widget and the plugins this plugin may track.
 */
export function createActionContext<S>(
  deps: ContextDeps,
  pluginId: string,
  widget: { path: string; settings: S },
  opts: Omit<ContextOptions<S>, "settings">,
): ActionContext<S> {
  const base = createContext(deps, pluginId, { ...opts, settings: widget.settings });
  const { repos } = deps;
  const allowed = new Set([pluginId, ...(deps.registry?.get(pluginId)?.manifest?.composes ?? [])]);
  const own = (id: number): StoredRef => {
    const ref = repos.getRefById(id);
    if (!ref || ref.widgetPath !== widget.path) throw new Error(`Reference ${id} is not tracked in ${widget.path}`);
    return ref;
  };
  return {
    ...base,
    widget: {
      path: widget.path,
      settings: widget.settings,
      refs: () => repos.listRefs(widget.path),
      links: () => repos.listLinksForWidget(widget.path),
      track(ownerId, ref) {
        if (!allowed.has(ownerId)) throw new Error(`Plugin "${pluginId}" may not track items of "${ownerId}"`);
        const owner = deps.registry?.get(ownerId)?.module;
        if (!owner?.reference) throw new Error(`Plugin "${ownerId}" is not installed`);
        const parsed = owner.reference.safeParse(ref);
        if (!parsed.success) throw new Error(`Invalid ${ownerId} reference`);
        const refKey = owner.refKey(parsed.data);
        return repos.getRef(widget.path, ownerId, refKey) ?? repos.trackRef(widget.path, ownerId, refKey, parsed.data);
      },
      untrack(id, o) {
        own(id);
        repos.removeRef(id, o?.cascade ?? false);
      },
      link(from, to) {
        own(from);
        own(to);
        repos.createLink(from, to, pluginId);
      },
      unlink(from, to) {
        repos.removeLink(from, to);
      },
      transaction: (fn) => repos.transaction(fn),
    },
  };
}

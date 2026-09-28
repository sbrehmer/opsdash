import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve, sep } from "node:path";
import { serve } from "@hono/node-server";
import { type FSWatcher, watch } from "chokidar";
import type { DestinationStream } from "pino";
import { configLocation, loadConfig } from "./config/load.ts";
import { deleteOrphans } from "./config/orphans.ts";
import { type ResolvedConfig, resolveConfig } from "./config/resolve.ts";
import { createApp } from "./http/app.ts";
import { EventHub } from "./http/hub.ts";
import { buildVendorShims } from "./http/vendor.ts";
import { createLogger, type Logger } from "./log.ts";
import type { ContextDeps } from "./plugins/context.ts";
import { MANIFEST_FILE } from "./plugins/manifest.ts";
import { PluginRegistry } from "./plugins/registry.ts";
import { Scheduler } from "./refresh/scheduler.ts";
import { loadEnv } from "./secrets/env.ts";
import { Redactor } from "./secrets/redact.ts";
import { openStore, type Store } from "./store/db.ts";
import { createRepos, type Repos } from "./store/repos.ts";

export interface OpsdashOptions {
  configDir: string;
  pluginsDir: string;
  dbFile: string;
  envFile?: string;
  mock?: boolean;
  port?: number;
  hostname?: string;
  webDir?: string;
  /** Watch config and plugin files for hot reload (default true). */
  watch?: boolean;
  /** Start refresh timers (default true). Tests drive `scheduler.tick()` directly when false. */
  timers?: boolean;
  logDestination?: DestinationStream;
  processEnv?: NodeJS.ProcessEnv;
}

export interface Opsdash {
  port: number;
  url: string;
  log: Logger;
  store: Store;
  repos: Repos;
  registry: PluginRegistry;
  scheduler: Scheduler;
  hub: EventHub;
  resolved(): ResolvedConfig;
  reloadConfig(): void;
  reloadPlugin(dir: string): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_WEB_DIR = resolve(import.meta.dirname, "../../web/dist");

export async function startOpsdash(options: OpsdashOptions): Promise<Opsdash> {
  const mock = options.mock ?? false;
  const redactor = new Redactor();
  const log = createLogger(redactor, options.logDestination);
  const env = loadEnv(options.envFile, options.processEnv ?? process.env);
  const store = openStore(resolve(options.dbFile), log);
  const repos = createRepos(store.db);
  const registry = new PluginRegistry(options.pluginsDir, log);
  await registry.loadAll();

  const load = () => resolveConfig(loadConfig(options.configDir, log), registry, { mock, env, redactor });
  let resolved = load();
  deleteOrphans(resolved, repos, log);

  const hub = new EventHub();
  const visiblePaths = () => {
    const viewed = hub.viewedDashboards();
    return new Set([...resolved.widgets.values()].filter((w) => viewed.has(w.dashboardId)).map((w) => w.path));
  };
  const context: ContextDeps = { repos, env, redactor, log, mock, registry, resolved: () => resolved };
  const scheduler = new Scheduler({
    registry,
    repos,
    redactor,
    log,
    mock,
    context,
    resolved: () => resolved,
    visiblePaths,
    publish: (data) => hub.publishWidget(data),
  });
  if (options.timers !== false) scheduler.reconfigure();

  const app = createApp({
    log,
    resolved: () => resolved,
    registry,
    scheduler,
    hub,
    store,
    repos,
    redactor,
    mock,
    webDir: options.webDir ?? DEFAULT_WEB_DIR,
    vendor: await buildVendorShims(),
    visiblePaths,
    visibilityChanged: (before) => [...visiblePaths()].filter((p) => !before.has(p)),
  });

  /** Applies a newly resolved config: notifies viewers, deletes orphans, refreshes changed widgets. */
  const apply = (next: ResolvedConfig, reason: string) => {
    const prev = resolved;
    resolved = next;
    const prevIds = [...prev.dashboards.values()].map((d) => `${d.id}:${d.title}:${d.errors.length > 0}`).join("|");
    const nextIds = [...next.dashboards.values()].map((d) => `${d.id}:${d.title}:${d.errors.length > 0}`).join("|");
    if (prevIds !== nextIds) hub.broadcast("dashboards-changed", {});
    const changed: string[] = [];
    for (const d of next.dashboards.values()) {
      if (JSON.stringify(prev.dashboards.get(d.id)) !== JSON.stringify(d)) {
        changed.push(d.id);
        hub.toDashboard(d.id, "dashboard-changed", { id: d.id });
      }
    }
    for (const d of prev.dashboards.keys())
      if (!next.dashboards.has(d)) hub.toDashboard(d, "dashboard-changed", { id: d });
    // Plugin-level config (settings, timings, mock faults) affects every widget of that plugin.
    const pluginKey = (r: ResolvedConfig, id: string) => JSON.stringify([r.set.plugins[id]?.value, r.plugins.get(id)]);
    const changedPlugins = new Set(
      [...new Set([...prev.plugins.keys(), ...next.plugins.keys()])].filter(
        (id) => pluginKey(prev, id) !== pluginKey(next, id),
      ),
    );
    if (changedPlugins.size > 0) scheduler.cache.clear();
    deleteOrphans(next, repos, log);
    if (options.timers !== false) scheduler.reconfigure();
    const visible = visiblePaths();
    const rerun = [...next.widgets.values()]
      .filter((w) => (changed.includes(w.dashboardId) || changedPlugins.has(w.pluginId)) && visible.has(w.path))
      .map((w) => w.path);
    if (rerun.length > 0) void scheduler.runPaths(rerun);
    log.info(
      { event: "config.reloaded", reason, changed, changedPlugins: [...changedPlugins], errors: next.errors.length },
      "Configuration reloaded",
    );
  };

  const reloadConfig = () => apply(load(), "config");
  const reloadPlugin = async (dir: string) => {
    const id = await registry.reload(dir);
    if (!id) return;
    scheduler.cache.clear();
    apply(load(), `plugin ${id}`);
    const record = registry.get(id);
    hub.broadcast("plugin-reloaded", {
      id,
      clientUrl: record ? `/plugins/${id}/client.js?v=${record.revision}` : undefined,
    });
    const visible = visiblePaths();
    void scheduler.runPaths(
      [...resolved.widgets.values()].filter((w) => w.pluginId === id && visible.has(w.path)).map((w) => w.path),
    );
  };

  const watchers: FSWatcher[] = [];
  if (options.watch !== false) {
    const debounce = (fn: () => void, ms = 150) => {
      let t: NodeJS.Timeout | undefined;
      return () => {
        clearTimeout(t);
        t = setTimeout(fn, ms);
      };
    };
    const onConfig = debounce(reloadConfig);
    watchers.push(
      watch(configLocation(options.configDir).dir, {
        ignoreInitial: true,
        ignored: (p, stats) => !!stats?.isFile() && !/\.ya?ml$/.test(p),
      }).on("all", onConfig),
    );
    const pluginTimers = new Map<string, () => void>();
    watchers.push(
      watch(registry.dir, {
        ignoreInitial: true,
        depth: 3,
        ignored: (p) => p.includes(`${sep}node_modules`) || p.includes(`${sep}src`),
      }).on("all", (_event, file) => {
        if (!file.endsWith(join(...MANIFEST_FILE.split("/")))) return;
        const dir = resolve(file, "../..");
        if (!pluginTimers.has(dir))
          pluginTimers.set(
            dir,
            debounce(() => void reloadPlugin(dir)),
          );
        pluginTimers.get(dir)!();
      }),
    );
  }

  const server = serve({ fetch: app.fetch, port: options.port ?? 4400, hostname: options.hostname ?? "0.0.0.0" });
  await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
  const port = (server.address() as AddressInfo).port;
  log.info(
    {
      event: "server.ready",
      port,
      mock,
      plugins: registry.loaded().map((p) => p.id),
      configErrors: resolved.errors.length,
    },
    `Opsdash listening on http://localhost:${port}`,
  );

  return {
    port,
    url: `http://localhost:${port}`,
    log,
    store,
    repos,
    registry,
    scheduler,
    hub,
    resolved: () => resolved,
    reloadConfig,
    reloadPlugin,
    async close() {
      scheduler.stop();
      await Promise.all(watchers.map((w) => w.close()));
      await new Promise<void>((r) => {
        (server as Server).closeAllConnections();
        server.close(() => r());
      });
      await scheduler.idle();
      store.close();
    },
  };
}

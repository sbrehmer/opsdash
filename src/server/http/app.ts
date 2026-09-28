import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { PLUGIN_API_VERSION } from "@opsdash/plugin-sdk";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ResolvedConfig } from "../config/resolve.ts";
import { publishedConfigSchema } from "../config/schema.ts";
import type { PluginRegistry } from "../plugins/registry.ts";
import type { Scheduler } from "../refresh/scheduler.ts";
import type { WidgetData } from "../refresh/types.ts";
import type { Redactor } from "../secrets/redact.ts";
import type { Store } from "../store/db.ts";
import type { Repos } from "../store/repos.ts";
import { actionRoutes } from "./actions.ts";
import { health } from "./health.ts";
import type { EventHub } from "./hub.ts";
import { trackingRoutes } from "./tracking.ts";
import { importMap } from "./vendor.ts";

export const APP_VERSION = "0.1.0";

export interface AppDeps {
  log?: import("../log.ts").Logger;
  resolved: () => ResolvedConfig;
  registry: PluginRegistry;
  scheduler: Scheduler;
  hub: EventHub;
  store: Store;
  repos: Repos;
  redactor: Redactor;
  mock: boolean;
  webDir: string;
  vendor: Map<string, string>;
  /** Paths that become visible when a viewer opens a dashboard; returns them for an immediate run. */
  visibilityChanged: (before: Set<string>) => string[];
  visiblePaths: () => Set<string>;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const { registry, scheduler, hub, redactor } = deps;

  app.get("/healthz", (c) => {
    const h = health(deps.store, deps.resolved(), registry, scheduler.failing);
    return c.json(h, h.status === "unhealthy" ? 503 : 200);
  });

  app.get("/api/meta", (c) => c.json({ version: APP_VERSION, pluginApiVersion: PLUGIN_API_VERSION, mock: deps.mock }));

  app.get("/api/dashboards", (c) => {
    const r = deps.resolved();
    return c.json(
      [...r.dashboards.values()].map((d) => ({
        id: d.id,
        title: d.title,
        status: d.errors.length > 0 ? "invalid" : "ok",
        errorCount: d.errors.length,
      })),
    );
  });

  app.get("/api/dashboards/:id", (c) => {
    const d = deps.resolved().dashboards.get(c.req.param("id"));
    return d ? c.json(redactor.deep(d)) : c.json({ error: "Unknown dashboard" }, 404);
  });

  app.get("/api/status", (c) => {
    const r = deps.resolved();
    return c.json(
      redactor.deep({
        config: { dir: r.set.dir, missing: r.set.missing, files: r.set.files, errors: r.errors },
        plugins: registry.all().map((p) => ({
          id: p.id,
          version: p.version,
          state: p.state,
          refusal: p.refusal,
          issues: r.plugins.get(p.id)?.issues ?? [],
        })),
      }),
    );
  });

  app.get("/api/events", (c) => {
    const dashboardId = c.req.query("dashboard") ?? "";
    const dashboard = deps.resolved().dashboards.get(dashboardId);
    if (!dashboard) return c.json({ error: "Unknown dashboard" }, 404);
    return streamSSE(c, async (stream) => {
      const before = deps.visiblePaths();
      const unsubscribe = hub.subscribe(dashboardId, (event, data) => {
        void stream.writeSSE({ event, data: JSON.stringify(data) });
      });
      stream.onAbort(unsubscribe);
      const widgets = [...deps.resolved().widgets.values()].filter((w) => w.dashboardId === dashboardId);
      // Composite widgets (API 1.1) are assembled from the latest per-item results before the snapshot.
      await Promise.all(
        widgets
          .filter((w) => registry.isComposite(w.pluginId) && w.status === "ok")
          .map((w) => scheduler.refreshComposite(w.path)),
      );
      const snapshot: WidgetData[] = widgets.map(
        (w) => scheduler.latest(w.path) ?? { path: w.path, state: "loading", items: [] },
      );
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ widgets: snapshot }) });
      const newlyVisible = deps.visibilityChanged(before);
      if (newlyVisible.length > 0) void scheduler.runPaths(newlyVisible);
      while (!stream.aborted && !stream.closed) {
        await stream.sleep(25_000);
        if (!stream.aborted) await stream.write(": keepalive\n\n");
      }
      unsubscribe();
    });
  });

  app.route("/api/widgets", actionRoutes(deps));
  app.route("/api/widgets", trackingRoutes(deps));

  const jsonSchema = JSON.stringify(
    z.toJSONSchema(publishedConfigSchema, { io: "input", unrepresentable: "any" }),
    null,
    2,
  );
  app.get("/schema/config.v1.json", (c) => c.body(jsonSchema, 200, { "content-type": "application/schema+json" }));

  app.get("/vendor/:file", (c) => {
    const shim = deps.vendor.get(c.req.param("file").replace(/\.js$/, ""));
    return shim
      ? c.body(shim, 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" })
      : c.notFound();
  });

  app.get("/plugins/:id/:file", (c) => {
    const record = registry.get(c.req.param("id"));
    const file = c.req.param("file");
    const m = record?.manifest;
    const allowed = m ? [m.client, m.style].filter(Boolean) : [];
    if (!record || !allowed.includes(file)) return c.notFound();
    const body = readFileSync(join(record.dir, "dist", file));
    const type = file.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    return c.body(body, 200, { "content-type": type, "cache-control": "no-cache" });
  });

  const indexFile = join(deps.webDir, "index.html");
  const renderIndex = () =>
    existsSync(indexFile)
      ? readFileSync(indexFile, "utf8").replace(
          /<script type="importmap">[\s\S]*?<\/script>/,
          `<script type="importmap">${importMap()}</script>`,
        )
      : "<!doctype html><title>Opsdash</title><p>Web UI not built. Run <code>pnpm build</code>.</p>";

  app.use("/assets/*", serveStatic({ root: deps.webDir }));
  app.get("/favicon.svg", serveStatic({ root: deps.webDir }));
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
    return c.html(renderIndex());
  });

  return app;
}

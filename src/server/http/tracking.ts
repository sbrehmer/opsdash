import { Hono } from "hono";
import { createContext } from "../plugins/context.ts";
import { DuplicateRefError } from "../store/repos.ts";
import type { AppDeps } from "./app.ts";

/**
 * Track and untrack items on a widget (FR-032). This is data entry, not configuration: the only input
 * the UI accepts. The widget path is URL-encoded as one segment.
 */
export function trackingRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/:path/items", (c) => {
    const path = decodeURIComponent(c.req.param("path"));
    if (!deps.resolved().widgets.has(path)) return c.json({ error: `Unknown widget ${path}` }, 404);
    return c.json(
      deps.repos.listRefs(path).map((r) => ({ plugin: r.pluginId, id: r.id, refKey: r.refKey, ref: r.ref })),
    );
  });

  app.post("/:path/items", async (c) => {
    const path = decodeURIComponent(c.req.param("path"));
    const resolved = deps.resolved();
    const widget = resolved.widgets.get(path);
    if (widget?.status !== "ok") return c.json({ error: `Unknown widget ${path}` }, 404);
    const record = deps.registry.get(widget.pluginId);
    if (!record?.module || !record.manifest?.capabilities.includes("track")) {
      return c.json({ error: `Plugin ${widget.pluginId} does not support tracking items` }, 400);
    }
    const body = (await c.req.json().catch(() => ({}))) as { input?: unknown };
    if (typeof body.input !== "string" || body.input.trim() === "")
      return c.json({ error: "Enter an item identifier" }, 422);

    const runtime = resolved.plugins.get(widget.pluginId);
    const plugin = record.module;
    const source = deps.mock ? plugin.mock : plugin;
    const ctx = createContext(deps.scheduler.contextDeps, widget.pluginId, {
      settings: widget.settings,
      timeoutMs: runtime?.timeout ?? 10_000,
      allowedEnv: record.manifest.env,
      mockFaults: runtime?.mockFaults,
    });
    let parsed: Awaited<ReturnType<typeof source.parseReference>>;
    try {
      parsed = await source.parseReference(body.input, ctx);
    } catch (err) {
      return c.json({ error: deps.redactor.string((err as Error).message) }, 422);
    }
    if ("error" in parsed) return c.json({ error: deps.redactor.string(parsed.error) }, 422);
    const ref = plugin.reference.safeParse(parsed.ok);
    if (!ref.success) return c.json({ error: "The plugin returned an invalid reference" }, 422);
    const refKey = plugin.refKey(ref.data);
    try {
      deps.repos.trackRef(path, widget.pluginId, refKey, ref.data);
    } catch (err) {
      if (err instanceof DuplicateRefError)
        return c.json({ error: `${refKey} is already tracked in this widget` }, 409);
      throw err;
    }
    void deps.scheduler.runPaths([path]);
    return c.json({ refKey, ref: ref.data }, 201);
  });

  app.delete("/:path/items/:refKey", (c) => {
    const path = decodeURIComponent(c.req.param("path"));
    const refKey = decodeURIComponent(c.req.param("refKey"));
    const widget = deps.resolved().widgets.get(path);
    const pluginId = c.req.query("plugin") ?? widget?.pluginId;
    const ref = pluginId ? deps.repos.getRef(path, pluginId, refKey) : undefined;
    if (!ref) return c.json({ error: `${refKey} is not tracked in ${path}` }, 404);
    deps.repos.removeRef(ref.id, c.req.query("cascade") === "1");
    void deps.scheduler.runPaths([path]);
    return c.body(null, 204);
  });

  return app;
}

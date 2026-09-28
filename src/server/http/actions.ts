import { Hono } from "hono";
import { createActionContext } from "../plugins/context.ts";
import type { AppDeps } from "./app.ts";

/**
 * Widget actions (plugin API 1.1, capability "actions"): named operations that change only Opsdash's own store
 * for the calling widget. Never touch source systems (constitution III).
 */
export function actionRoutes(deps: AppDeps) {
  const app = new Hono();

  app.post("/:path/actions/:name", async (c) => {
    const path = decodeURIComponent(c.req.param("path"));
    const name = c.req.param("name");
    const resolved = deps.resolved();
    const widget = resolved.widgets.get(path);
    if (widget?.status !== "ok") return c.json({ error: `Unknown widget ${path}` }, 404);
    const record = deps.registry.get(widget.pluginId);
    if (!record?.module || !record.manifest) return c.json({ error: `Unknown widget ${path}` }, 404);
    if (!record.manifest.capabilities.includes("actions")) {
      return c.json({ error: `Plugin ${widget.pluginId} does not support actions` }, 400);
    }
    const action = record.module.actions?.[name];
    if (typeof action !== "function") return c.json({ error: `Unknown action ${name}` }, 404);

    const payload = await c.req.json().catch(() => ({}));
    const runtime = resolved.plugins.get(widget.pluginId);
    const ctx = createActionContext(
      deps.scheduler.contextDeps,
      widget.pluginId,
      { path, settings: widget.settings },
      { timeoutMs: runtime?.timeout ?? 10_000, allowedEnv: record.manifest.env, mockFaults: runtime?.mockFaults },
    );
    let result: Awaited<ReturnType<typeof action>>;
    try {
      result = await action(payload, ctx);
    } catch (err) {
      return c.json({ error: deps.redactor.string((err as Error).message) }, 422);
    }
    if ("error" in result) return c.json({ error: deps.redactor.string(result.error) }, 422);
    deps.log?.info({ event: "widget.action", path, action: name }, "Widget action");
    await deps.scheduler.refreshComposite(path);
    void deps.scheduler.runPaths([path]);
    return c.json(result, 200);
  });

  return app;
}

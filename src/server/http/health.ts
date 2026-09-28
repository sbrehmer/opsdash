import type { ResolvedConfig } from "../config/resolve.ts";
import type { PluginRegistry } from "../plugins/registry.ts";
import type { Store } from "../store/db.ts";

export type HealthStatus = "healthy" | "degraded" | "unhealthy";

/** FR-047: unhealthy when the store is unusable; degraded on config errors or plugin problems. */
export function health(store: Store, resolved: ResolvedConfig, registry: PluginRegistry, failing: Set<string>) {
  const reasons: string[] = [];
  if (!store.healthy()) return { status: "unhealthy" as HealthStatus, reasons: ["store is unusable"] };
  if (resolved.set.missing) reasons.push("config: opsdash.yaml not found");
  if (resolved.errors.length > 0) reasons.push(`config: ${resolved.errors.length} error(s)`);
  for (const r of registry.all()) if (r.state === "refused") reasons.push(`plugin ${r.id}: refused`);
  for (const p of resolved.plugins.values()) for (const issue of p.issues) reasons.push(`plugin ${p.id}: ${issue}`);
  for (const id of failing) reasons.push(`plugin ${id}: last refresh failed`);
  return { status: (reasons.length > 0 ? "degraded" : "healthy") as HealthStatus, reasons };
}

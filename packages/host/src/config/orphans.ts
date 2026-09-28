import type { Logger } from "../log.ts";
import type { Repos } from "../store/repos.ts";
import type { ResolvedConfig } from "./resolve.ts";

/**
 * Deletes tracked references of widgets that a successfully loaded config no longer contains
 * (FR-032, data-model §C). Nothing is deleted when any file failed to parse, when there are global
 * errors, or when the widget's dashboard (or a block on its chain) has errors.
 */
export function deleteOrphans(resolved: ResolvedConfig, repos: Repos, log: Logger): number {
  const { set } = resolved;
  if (set.missing || !set.valid) return 0;
  if (resolved.errors.some((e) => !e.scope.dashboard && !e.scope.block && !e.scope.plugin)) return 0;
  // A dashboard whose id could not be read might be the one a stored path belongs to.
  if ([...resolved.invalidDashboards].some((id) => id.startsWith("~"))) return 0;
  const gone: Array<{ widgetPath: string; count: number }> = [];
  for (const entry of repos.pathsWithRefs()) {
    if (resolved.widgets.has(entry.widgetPath)) continue;
    const dashboardId = entry.widgetPath.split("/")[0]!;
    if (resolved.invalidDashboards.has(dashboardId)) continue;
    gone.push(entry);
  }
  repos.deleteRefsForPaths(gone.map((g) => g.widgetPath));
  for (const g of gone)
    log.info(
      { event: "refs.deleted", widgetPath: g.widgetPath, count: g.count },
      "Deleted tracked items of removed widget",
    );
  return gone.reduce((n, g) => n + g.count, 0);
}

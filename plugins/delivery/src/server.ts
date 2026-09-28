import { type ActionContext, type CompositeWidgetData, definePlugin, z } from "@opsdash/plugin-sdk";
import { actions, dismissKey } from "./actions.ts";
import { buildRows, DURATION, expired, parseDuration } from "./rows.ts";

const settings = z.strictObject({
  retention: z.string().regex(DURATION, 'Durations look like "7d", "12h" or "30m"').default("7d"),
  storyProjects: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/, "Project keys look like PROJ")).optional(),
});

type Settings = z.output<typeof settings>;

/**
 * Removes rows whose pull request was merged or closed longer ago than `retention` (with their now
 * unlinked job and story), cleans up dismissals of rows that are gone, and returns `meta.dismissed`.
 */
async function onData(data: CompositeWidgetData, ctx: ActionContext<Settings>) {
  const retentionMs = parseDuration(ctx.widget.settings?.retention ?? "7d");
  const now = Date.now();
  const tracked = new Set<string>();
  for (const row of buildRows(data.items, data.links)) {
    if (row.pr.id !== undefined && expired(row, retentionMs, now)) {
      ctx.widget.untrack(row.pr.id, { cascade: true });
      ctx.log.info({ event: "delivery.row.expired", path: data.path, pr: row.pr.refKey }, "Tracker row expired");
    } else {
      tracked.add(row.pr.refKey);
    }
  }

  const prefix = dismissKey(data.path, "");
  const dismissed: Record<string, string[]> = {};
  for (const { key, value } of ctx.state.list()) {
    if (!key.startsWith(prefix)) continue;
    const pr = key.slice(prefix.length);
    if (tracked.has(pr) && Array.isArray(value)) dismissed[pr] = value as string[];
    else ctx.state.delete(key);
  }
  // storyProjects defaults to the Jira plugin's projectKeys (contracts/plugins.md §delivery).
  let storyProjects = ctx.widget.settings?.storyProjects;
  if (!storyProjects) {
    try {
      const keys = await ctx.plugins.resolve("jira", "projectKeys", null);
      storyProjects = Array.isArray(keys) ? (keys as string[]) : [];
    } catch {
      storyProjects = [];
    }
  }
  return { meta: { dismissed, storyProjects } };
}

export default definePlugin({ settings, actions, onData });

import type { ActionContext, StoredRef } from "@opsdash/plugin-sdk";

/** GitHub pull request data (data-model §GitHub item). */
export interface PrData {
  repo: string;
  number: number;
  url: string;
  title: string;
  author: string;
  branch: string;
  state: "draft" | "open" | "merged" | "closed";
  review: "approved" | "changes_requested" | "review_required" | null;
  checks: "success" | "failure" | "pending" | "error" | null;
  updatedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
}

/** Jenkins job data (data-model §Jenkins item). */
export interface JobData {
  pipeline: string;
  job: string;
  url: string;
  exists: boolean;
  build: {
    number: number;
    url: string;
    result: "success" | "failure" | "unstable" | "aborted" | "not_built" | null;
    building: boolean;
    startedAt: number;
    durationMs: number;
    estimatedDurationMs: number;
  } | null;
  main: { branch: string; lastSuccessAt: number | null; url: string | null };
}

/** Jira issue data (data-model §Jira item). */
export interface StoryData {
  key: string;
  url: string;
  title: string;
  status: string;
  category: "todo" | "inprogress" | "done";
  assignee: string | null;
}

/** A composite widget item, as the host assembles it (server) or pushes it to the browser (client). */
export interface Item<D = unknown> {
  plugin?: string;
  id?: number;
  refKey: string;
  ref: unknown;
  data?: D;
  error?: string;
  state?: string;
  lastSuccessAt?: number;
}

export interface Row {
  pr: Item<PrData>;
  job?: Item<JobData>;
  story?: Item<StoryData>;
}

export interface Group {
  repo: string;
  rank: number;
  rows: Row[];
}

type Link = { from: number; to: number };

/** Rows keyed by the GitHub reference; the job and story are the PR's linked Jenkins and Jira items. */
export function buildRows(items: readonly Item[], links: readonly Link[]): Row[] {
  const byId = new Map<number, Item>();
  for (const item of items) if (item.id !== undefined) byId.set(item.id, item);
  return items
    .filter((i) => i.plugin === "github")
    .map((pr) => {
      const row: Row = { pr: pr as Item<PrData> };
      for (const l of links) {
        if (l.from !== pr.id) continue;
        const target = byId.get(l.to);
        if (target?.plugin === "jenkins" && !row.job) row.job = target as Item<JobData>;
        else if (target?.plugin === "jira" && !row.story) row.story = target as Item<StoryData>;
      }
      return row;
    });
}

export interface StoredRow {
  pr: StoredRef;
  job?: StoredRef;
  story?: StoredRef;
}

/** The stored references of the row whose pull request has `prRefKey`, in the calling widget. */
export function findRow(ctx: ActionContext, prRefKey: string): StoredRow | undefined {
  const refs = ctx.widget.refs();
  const pr = refs.find((r) => r.pluginId === "github" && r.refKey === prRefKey);
  if (!pr) return undefined;
  const byId = new Map(refs.map((r) => [r.id, r]));
  const row: StoredRow = { pr };
  for (const l of ctx.widget.links()) {
    if (l.from !== pr.id) continue;
    const target = byId.get(l.to);
    if (target?.pluginId === "jenkins" && !row.job) row.job = target;
    else if (target?.pluginId === "jira" && !row.story) row.story = target;
  }
  return row;
}

const STORY_KEY = /[A-Z][A-Z0-9_]+-\d+/g;

/** Story keys found in the title, then the branch, without duplicates; filtered by `projects` when non-empty. */
export function storyKeys(
  title: string | undefined,
  branch: string | undefined,
  projects?: readonly string[],
): string[] {
  const found = [...(title ?? "").matchAll(STORY_KEY), ...(branch ?? "").matchAll(STORY_KEY)].map((m) => m[0]);
  const keep = projects && projects.length > 0 ? new Set(projects) : undefined;
  return [...new Set(found)].filter((k) => !keep || keep.has(k.slice(0, k.lastIndexOf("-"))));
}

/** Attention rank (FR-026): 0 needs attention, 1 building, 2 anything else. */
export function rank(row: Row): number {
  const build = row.job?.data?.build;
  const pr = row.pr.data;
  if (build?.result === "failure" || build?.result === "unstable") return 0;
  if (pr?.review === "changes_requested" || pr?.checks === "failure" || pr?.checks === "error") return 0;
  if (build?.building) return 1;
  return 2;
}

/** The most recent activity of a row: the PR's `updatedAt` or the build's start time. */
export function activity(row: Row): number {
  const updated = row.pr.data?.updatedAt ? Date.parse(row.pr.data.updatedAt) : 0;
  return Math.max(Number.isNaN(updated) ? 0 : updated, row.job?.data?.build?.startedAt ?? 0);
}

/** Rows by rank, then most recent activity first. */
export function sortRows(rows: readonly Row[]): Row[] {
  return [...rows].sort((a, b) => rank(a) - rank(b) || activity(b) - activity(a));
}

export function repoOf(row: Row): string {
  return row.pr.data?.repo ?? (row.pr.ref as { repo?: string } | undefined)?.repo ?? "";
}

/** Groups by repository; groups sorted by their lowest rank, then by name; rows by attention order. */
export function groupRows(rows: readonly Row[]): Group[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const repo = repoOf(row);
    groups.set(repo, [...(groups.get(repo) ?? []), row]);
  }
  return [...groups]
    .map(([repo, rs]) => {
      const sorted = sortRows(rs);
      return { repo, rows: sorted, rank: Math.min(...sorted.map(rank)) };
    })
    .sort((a, b) => a.rank - b.rank || a.repo.localeCompare(b.repo));
}

export function isDone(row: Row): boolean {
  const state = row.pr.data?.state;
  return state === "merged" || state === "closed";
}

/** A done row whose merge or close time is older than the retention. */
export function expired(row: Row, retentionMs: number, now: number): boolean {
  if (!isDone(row)) return false;
  const at = row.pr.data?.mergedAt ?? row.pr.data?.closedAt;
  if (!at) return false;
  const t = Date.parse(at);
  return !Number.isNaN(t) && now - t > retentionMs;
}

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
export const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;

/** Parses "250ms", "10s", "5m", "2h" or "7d" into milliseconds. */
export function parseDuration(text: string): number {
  const m = DURATION.exec(text.trim());
  if (!m) throw new Error(`Invalid duration "${text}"`);
  return Number(m[1]) * UNITS[m[2]!]!;
}

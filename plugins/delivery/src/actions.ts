import type { Action, ActionContext, ActionResult, StoredRef } from "@opsdash/plugin-sdk";
import { findRow, type StoredRow } from "./rows.ts";

interface PrRef {
  repo: string;
  number: number;
}
interface JobRef {
  pipeline: string;
  job: string;
}

type Resolved<T> = { ok: T; pending?: boolean } | { error: string };

const prKey = (r: PrRef) => `${r.repo}#${r.number}`;
const jobKey = (r: JobRef) => `${r.pipeline}/${r.job}`;
export const dismissKey = (path: string, pr: string) => `dismissed:${path}:${pr}`;

class ActionError extends Error {}
const fail = (message: string): never => {
  throw new ActionError(message);
};

/** Reads an optional, non-empty string field of the payload. */
function field(payload: unknown, name: string): string | undefined {
  const value = (payload as Record<string, unknown> | null)?.[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return fail(`The ${name} must be text.`);
  return value.trim() || undefined;
}
const required = (payload: unknown, name: string, label: string): string =>
  field(payload, name) ?? fail(`Enter ${label}.`);

async function parse<T>(ctx: ActionContext, pluginId: string, input: string): Promise<T> {
  const result = await ctx.plugins.parse(pluginId, input);
  return "ok" in result ? (result.ok as T) : fail(result.error);
}

async function resolve<T>(ctx: ActionContext, name: string, input: unknown): Promise<{ ok: T; pending?: boolean }> {
  let result: Resolved<T>;
  try {
    result = (await ctx.plugins.resolve("jenkins", name, input)) as Resolved<T>;
  } catch (err) {
    return fail((err as Error).message);
  }
  if (!result || typeof result !== "object") return fail("Jenkins returned no answer.");
  return "error" in result ? fail(result.error) : result;
}

/** Checks that the job builds the pull request. */
async function checkJob(ctx: ActionContext, job: JobRef, pr: PrRef): Promise<void> {
  const built = (await resolve<PrRef>(ctx, "pullRequestForJob", job)).ok;
  if (built.repo !== pr.repo || built.number !== pr.number) {
    fail(`The job ${jobKey(job)} builds a different pull request (${prKey(built)}), not ${prKey(pr)}.`);
  }
}

function rowOf(ctx: ActionContext, pr: string): StoredRow {
  return findRow(ctx, pr) ?? fail(`The pull request ${pr} is not tracked in this tracker.`);
}

const linkCount = (ctx: ActionContext, id: number) =>
  ctx.widget.links().filter((l) => l.from === id || l.to === id).length;

/** Unlinks `old` from the PR and removes it when nothing else links to it. Call inside a transaction. */
function detach(ctx: ActionContext, pr: StoredRef, old: StoredRef): void {
  ctx.widget.unlink(pr.id, old.id);
  if (linkCount(ctx, old.id) === 0) ctx.widget.untrack(old.id);
}

/** Links `next` (owned by `pluginId`) to the PR in place of `old`. */
function replace(ctx: ActionContext, pr: StoredRef, pluginId: string, next: unknown, old?: StoredRef): void {
  ctx.widget.transaction(() => {
    const ref = ctx.widget.track(pluginId, next);
    if (old?.id === ref.id) return;
    ctx.widget.link(pr.id, ref.id);
    if (old) detach(ctx, pr, old);
  });
}

async function addRow(payload: unknown, ctx: ActionContext): Promise<void> {
  const prInput = field(payload, "pr");
  const jobInput = field(payload, "job");
  const storyInput = field(payload, "story");
  if (!prInput && !jobInput) fail("Enter a pull request or a build job.");

  let pr = prInput ? await parse<PrRef>(ctx, "github", prInput) : undefined;
  let job = jobInput ? await parse<JobRef>(ctx, "jenkins", jobInput) : undefined;
  const story = storyInput ? await parse<{ key: string }>(ctx, "jira", storyInput) : undefined;

  if (pr && job) await checkJob(ctx, job, pr);
  else if (pr) job = (await resolve<JobRef>(ctx, "jobForPullRequest", pr)).ok;
  else if (job) pr = (await resolve<PrRef>(ctx, "pullRequestForJob", job)).ok;

  const prRef = pr as PrRef;
  const jobRef = job as JobRef;
  if (findRow(ctx, prKey(prRef))) fail(`The pull request ${prKey(prRef)} is already tracked.`);
  const owner = ctx.widget.refs().find((r) => r.pluginId === "jenkins" && r.refKey === jobKey(jobRef));
  if (owner && ctx.widget.links().some((l) => l.to === owner.id)) {
    fail(`The job ${jobKey(jobRef)} is already tracked in another row.`);
  }

  ctx.widget.transaction(() => {
    const p = ctx.widget.track("github", prRef);
    const j = ctx.widget.track("jenkins", jobRef);
    ctx.widget.link(p.id, j.id);
    if (story) ctx.widget.link(p.id, ctx.widget.track("jira", story).id);
  });
}

async function setStory(payload: unknown, ctx: ActionContext): Promise<void> {
  const row = rowOf(ctx, required(payload, "pr", "a pull request"));
  const story = await parse<{ key: string }>(ctx, "jira", required(payload, "story", "a story"));
  replace(ctx, row.pr, "jira", story, row.story);
}

async function removeStory(payload: unknown, ctx: ActionContext): Promise<void> {
  const row = rowOf(ctx, required(payload, "pr", "a pull request"));
  const story = row.story;
  if (story) ctx.widget.transaction(() => detach(ctx, row.pr, story));
}

async function dismissSuggestion(payload: unknown, ctx: ActionContext): Promise<void> {
  const row = rowOf(ctx, required(payload, "pr", "a pull request"));
  const story = required(payload, "story", "a story");
  const key = dismissKey(ctx.widget.path, row.pr.refKey);
  const list = ctx.state.get<string[]>(key) ?? [];
  if (!list.includes(story)) ctx.state.set(key, [...list, story]);
}

async function reinferJob(payload: unknown, ctx: ActionContext): Promise<void> {
  const row = rowOf(ctx, required(payload, "pr", "a pull request"));
  const job = (await resolve<JobRef>(ctx, "jobForPullRequest", row.pr.ref)).ok;
  replace(ctx, row.pr, "jenkins", job, row.job);
}

async function setJob(payload: unknown, ctx: ActionContext): Promise<void> {
  const row = rowOf(ctx, required(payload, "pr", "a pull request"));
  const job = await parse<JobRef>(ctx, "jenkins", required(payload, "job", "a build job"));
  await checkJob(ctx, job, row.pr.ref as PrRef);
  replace(ctx, row.pr, "jenkins", job, row.job);
}

async function removeRow(payload: unknown, ctx: ActionContext): Promise<void> {
  const row = rowOf(ctx, required(payload, "pr", "a pull request"));
  ctx.widget.untrack(row.pr.id, { cascade: true });
  ctx.state.delete(dismissKey(ctx.widget.path, row.pr.refKey));
}

/** Wraps an action body: `ActionError`s become `{ error }` results; anything else becomes a 422 via the host. */
const action =
  (fn: (payload: unknown, ctx: ActionContext) => Promise<void>): Action =>
  async (payload, ctx): Promise<ActionResult> => {
    try {
      await fn(payload, ctx);
      return { ok: true };
    } catch (err) {
      if (err instanceof ActionError) return { error: err.message };
      throw err;
    }
  };

export const actions: Record<string, Action> = {
  addRow: action(addRow),
  setStory: action(setStory),
  removeStory: action(removeStory),
  linkSuggestion: action(setStory),
  dismissSuggestion: action(dismissSuggestion),
  reinferJob: action(reinferJob),
  setJob: action(setJob),
  removeRow: action(removeRow),
};

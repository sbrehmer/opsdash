import { type PluginContext, type Resolver, SourceError, sourceRequest } from "@opsdash/plugin-sdk";
import { jobPath, pipelineFor, repoFor } from "./paths.ts";
import { authHeaders, trimBase } from "./source.ts";
import type {
  JenkinsRef,
  JenkinsSettings,
  JobForPullRequestResult,
  PullRequestForJobResult,
  PullRequestInput,
} from "./types.ts";

const REPO = /^[^/\s]+\/[^/\s]+$/;
const PR_JOB = /^PR-(\d+)$/;

function asPullRequest(input: unknown): PullRequestInput | undefined {
  const v = input as Partial<PullRequestInput> | null;
  if (!v || typeof v.repo !== "string" || !REPO.test(v.repo)) return undefined;
  if (typeof v.number !== "number" || !Number.isInteger(v.number) || v.number < 1) return undefined;
  return { repo: v.repo, number: v.number };
}

function asJob(input: unknown): JenkinsRef | undefined {
  const v = input as Partial<JenkinsRef> | null;
  if (!v || typeof v.pipeline !== "string" || typeof v.job !== "string" || !v.pipeline || !v.job) return undefined;
  return { pipeline: v.pipeline, job: v.job };
}

const BAD_PR = { error: 'Expected a pull request { repo: "owner/name", number }' } as const;

/** Pure rule shared by the real and mock sources: `PR-<n>` in a pipeline that maps back to a repository. */
export function pullRequestForJob(input: unknown, settings: JenkinsSettings): PullRequestForJobResult {
  const ref = asJob(input);
  if (!ref) return { error: "Expected a Jenkins job { pipeline, job }" };
  const m = PR_JOB.exec(ref.job);
  if (!m) return { error: `Job ${ref.job} is not a pull request job (expected PR-<number>)` };
  const repo = repoFor(ref.pipeline, settings);
  if (!repo) {
    return {
      error: `Pipeline ${ref.pipeline} does not map to a repository (add it to the Jenkins plugin's pipelines setting)`,
    };
  }
  return { ok: { repo, number: Number(m[1]) } };
}

/** Real resolvers (T043): `jobForPullRequest` confirms the job with one `tree=jobs[name]` request. */
export const resolvers: Record<string, Resolver<JenkinsSettings>> = {
  async jobForPullRequest(input, ctx: PluginContext<JenkinsSettings>): Promise<JobForPullRequestResult> {
    const pr = asPullRequest(input);
    if (!pr) return BAD_PR;
    const pipeline = pipelineFor(pr.repo, ctx.settings);
    const job = `PR-${pr.number}`;
    let body: { jobs?: Array<{ name: string }> };
    try {
      body = await sourceRequest(
        `${trimBase(ctx.settings.baseUrl)}${jobPath(pipeline)}/api/json?tree=${encodeURIComponent("jobs[name]")}`,
        { tool: "Jenkins", headers: authHeaders(ctx) },
        ctx,
      );
    } catch (err) {
      if (err instanceof SourceError && err.status === 404)
        return { error: `No Jenkins pipeline ${pipeline} for ${pr.repo}` };
      throw err;
    }
    const listed = (body.jobs ?? []).some((j) => j.name === job);
    return listed ? { ok: { pipeline, job } } : { ok: { pipeline, job }, pending: true };
  },
  pullRequestForJob: (input, ctx) => pullRequestForJob(input, ctx.settings),
};

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Mock resolvers: the real rules without network; `noJob` → pending, `unknownPipelines` → error. */
export const mockResolvers: Record<string, Resolver<JenkinsSettings>> = {
  jobForPullRequest(input, ctx): JobForPullRequestResult {
    const pr = asPullRequest(input);
    if (!pr) return BAD_PR;
    const pipeline = pipelineFor(pr.repo, ctx.settings);
    const job = `PR-${pr.number}`;
    const scenario = ctx.mockFaults.scenario ?? {};
    if (list(scenario.unknownPipelines).includes(pipeline))
      return { error: `No Jenkins pipeline ${pipeline} for ${pr.repo}` };
    if (list(scenario.noJob).includes(`${pipeline}/${job}`)) return { ok: { pipeline, job }, pending: true };
    return { ok: { pipeline, job } };
  },
  pullRequestForJob: (input, ctx) => pullRequestForJob(input, ctx.settings),
};

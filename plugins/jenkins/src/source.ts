import { type FetchResults, type PluginContext, SourceError, sourceRequest } from "@opsdash/plugin-sdk";
import { jobPath, jobUrl, TREE } from "./paths.ts";
import {
  type JenkinsBuild,
  type JenkinsJob,
  type JenkinsMain,
  type JenkinsRef,
  type JenkinsSettings,
  mapResult,
  parseDuration,
  refKey,
} from "./types.ts";

export { jobPath, TREE } from "./paths.ts";

export const DEFAULT_RUNNING_REFRESH_MS = 10_000;

interface ApiBuild {
  number: number;
  url: string;
  result?: string | null;
  building?: boolean;
  timestamp: number;
  duration?: number;
  estimatedDuration?: number;
}

interface ApiJob {
  name: string;
  url?: string;
  lastBuild?: ApiBuild | null;
  lastSuccessfulBuild?: Pick<ApiBuild, "number" | "timestamp" | "url"> | null;
}

export const trimBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

/** `Authorization: Basic base64(user:token)`; the token comes only from the environment. */
export function authHeaders(ctx: PluginContext<JenkinsSettings>): Record<string, string> {
  const token = ctx.secrets.get(ctx.settings.token.env);
  return { authorization: `Basic ${Buffer.from(`${ctx.settings.user}:${token}`).toString("base64")}` };
}

export function runningRefreshMs(settings: Pick<JenkinsSettings, "runningRefreshInterval">): number {
  return parseDuration(settings.runningRefreshInterval) ?? DEFAULT_RUNNING_REFRESH_MS;
}

function mapBuild(b: ApiBuild): JenkinsBuild {
  const building = Boolean(b.building);
  return {
    number: b.number,
    url: b.url,
    result: mapResult(b.result, building),
    building,
    startedAt: b.timestamp,
    durationMs: b.duration ?? 0,
    estimatedDurationMs: b.estimatedDuration ?? -1,
  };
}

/**
 * Real Jenkins fetch (T043): one `GET {baseUrl}{jobPath(pipeline)}/api/json?tree=TREE` per pipeline. The host
 * groups refs by `batchKey` (the pipeline), but refs from several pipelines are still handled, one request each.
 */
export async function fetchJobs(refs: JenkinsRef[], ctx: PluginContext<JenkinsSettings>): Promise<FetchResults> {
  const { settings } = ctx;
  const base = trimBase(settings.baseUrl);
  const byPipeline = new Map<string, JenkinsRef[]>();
  for (const ref of refs) byPipeline.set(ref.pipeline, [...(byPipeline.get(ref.pipeline) ?? []), ref]);

  const results: FetchResults = new Map();
  let running = false;
  for (const [pipeline, group] of byPipeline) {
    let jobs: ApiJob[];
    try {
      const body = await sourceRequest<{ jobs?: ApiJob[] }>(
        `${base}${jobPath(pipeline)}/api/json?tree=${encodeURIComponent(TREE)}`,
        { tool: "Jenkins", headers: authHeaders(ctx) },
        ctx,
      );
      jobs = body.jobs ?? [];
    } catch (err) {
      if (err instanceof SourceError && err.status === 404) {
        for (const ref of group) results.set(refKey(ref), { error: `No Jenkins pipeline ${pipeline}` });
        continue;
      }
      throw err;
    }
    const byName = new Map(jobs.map((j) => [j.name, j]));
    const mainJob = byName.get(settings.mainBranch);
    const main: JenkinsMain = {
      branch: settings.mainBranch,
      lastSuccessAt: mainJob?.lastSuccessfulBuild?.timestamp ?? null,
      url: mainJob?.lastSuccessfulBuild?.url ?? null,
    };
    for (const ref of group) {
      const found = byName.get(ref.job);
      const build = found?.lastBuild ? mapBuild(found.lastBuild) : null;
      if (build?.building) running = true;
      const data: JenkinsJob = {
        pipeline,
        job: ref.job,
        url: found?.url ?? jobUrl(base, pipeline, ref.job),
        exists: Boolean(found),
        build,
        main,
      };
      results.set(refKey(ref), { data });
    }
  }
  if (running) ctx.scheduleNext(runningRefreshMs(settings));
  return results;
}

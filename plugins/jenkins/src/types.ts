export interface JenkinsRef {
  pipeline: string;
  job: string;
}

export interface JenkinsSettings {
  baseUrl: string;
  user: string;
  token: { env: string };
  /** `"owner/name"` → pipeline path `"folder/pipeline"`. */
  pipelines: Record<string, string>;
  /** Placeholders `{owner}` and `{name}`. */
  pipelineTemplate: string;
  /** Owner used by `pullRequestForJob` when the template has no {owner} placeholder. */
  defaultOwner?: string;
  mainBranch: string;
  runningRefreshInterval: string;
}

export type BuildResult = "success" | "failure" | "unstable" | "aborted" | "not_built" | null;

export interface JenkinsBuild {
  number: number;
  url: string;
  result: BuildResult;
  building: boolean;
  /** Epoch ms. */
  startedAt: number;
  durationMs: number;
  estimatedDurationMs: number;
}

export interface JenkinsMain {
  branch: string;
  lastSuccessAt: number | null;
  url: string | null;
}

export interface JenkinsJob {
  pipeline: string;
  job: string;
  url: string;
  exists: boolean;
  build: JenkinsBuild | null;
  main: JenkinsMain;
}

export interface PullRequestInput {
  repo: string;
  number: number;
}

export type JobForPullRequestResult = { ok: JenkinsRef; pending?: true } | { error: string };
export type PullRequestForJobResult = { ok: PullRequestInput } | { error: string };

export const refKey = (ref: JenkinsRef): string => `${ref.pipeline}/${ref.job}`;

/** Parses `"10s"`, `"5m"`, `"500ms"`, `"1h"` into milliseconds; `undefined` when invalid. */
export function parseDuration(text: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text.trim());
  if (!m) return undefined;
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] as "ms" | "s" | "m" | "h"];
  return Math.round(Number(m[1]) * unit);
}

/** Maps a Jenkins result string (`SUCCESS`, `FAILURE`, …) to the lowercase variant; building → null. */
export function mapResult(result: string | null | undefined, building: boolean): BuildResult {
  if (building || !result) return null;
  const r = result.toLowerCase();
  return r === "success" || r === "failure" || r === "unstable" || r === "aborted" || r === "not_built" ? r : null;
}

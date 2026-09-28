import { createMockSource, seededRng } from "@opsdash/plugin-sdk";
import { parseJenkinsInput } from "./parse.ts";
import { jobUrl } from "./paths.ts";
import { mockResolvers } from "./resolvers.ts";
import { runningRefreshMs, trimBase } from "./source.ts";
import type { BuildResult, JenkinsBuild, JenkinsJob, JenkinsRef, JenkinsSettings } from "./types.ts";

const HOUR = 3_600_000;
const MIN = 60_000;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Deterministic Jenkins mock. Build state is seeded by the ref key; scenario lists (`running`, `failed`,
 * `unstable`, `noBuild`, `noJob` by ref key; `unknownPipelines`, `mainNeverSucceeded` by pipeline) override it.
 * Running builds started `now mod estimate` ago, so their progress advances between refreshes.
 */
export const mock = createMockSource<JenkinsSettings, JenkinsRef>({
  refKey: (ref) => `${ref.pipeline}/${ref.job}`,
  fromKey: (key) => {
    const i = key.lastIndexOf("/");
    return { pipeline: key.slice(0, i), job: key.slice(i + 1) };
  },
  parseReference: parseJenkinsInput,
  resolvers: mockResolvers,
  generate: (ref, rng, ctx): JenkinsJob => {
    const now = Date.now();
    // Finished builds are anchored to the hour so repeated refreshes return the same data.
    const anchor = now - (now % HOUR);
    const key = `${ref.pipeline}/${ref.job}`;
    const scenario = ctx.mockFaults.scenario ?? {};
    const has = (name: string, value = key) => list(scenario[name]).includes(value);
    const base = trimBase(ctx.settings.baseUrl);
    const url = jobUrl(base, ref.pipeline, ref.job);

    const branch = ctx.settings.mainBranch;
    const mainRng = seededRng(`main:${ref.pipeline}`);
    const mainNumber = mainRng.int(20, 400);
    const main = has("mainNeverSucceeded", ref.pipeline)
      ? { branch, lastSuccessAt: null, url: null }
      : {
          branch,
          lastSuccessAt: anchor - mainRng.int(1, 48) * HOUR,
          url: `${jobUrl(base, ref.pipeline, branch)}${mainNumber}/`,
        };

    const number = rng.int(1, 60);
    const estimatedDurationMs = rng.int(3, 20) * MIN;
    const roll = rng.next();
    let state: "success" | "running" | "failure" | "unstable" | "aborted" =
      roll < 0.65 ? "success" : roll < 0.8 ? "running" : roll < 0.92 ? "failure" : roll < 0.97 ? "unstable" : "aborted";
    if (has("running")) state = "running";
    else if (has("failed")) state = "failure";
    else if (has("unstable")) state = "unstable";

    const exists = !has("noJob") && !has("unknownPipelines", ref.pipeline);
    let build: JenkinsBuild | null = null;
    if (exists && !has("noBuild")) {
      const building = state === "running";
      const durationMs = building ? 0 : Math.round(estimatedDurationMs * (0.7 + rng.next() * 0.6));
      build = {
        number,
        url: `${url}${number}/`,
        result: building ? null : (state as Exclude<BuildResult, null>),
        building,
        startedAt: building ? now - (now % estimatedDurationMs) : anchor - rng.int(10, 72 * 60) * MIN,
        durationMs,
        estimatedDurationMs,
      };
    }
    return { pipeline: ref.pipeline, job: ref.job, url, exists, build, main };
  },
  afterFetch: (_refs, results, ctx) => {
    for (const r of results.values()) {
      if ("data" in r && (r.data as JenkinsJob | undefined)?.build?.building) {
        ctx.scheduleNext(runningRefreshMs(ctx.settings));
        return;
      }
    }
  },
});

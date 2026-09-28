import { type PluginContext, SourceError } from "@opsdash/plugin-sdk";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseJenkinsInput } from "../../../plugins/jenkins/src/parse.ts";
import { jobPath, pipelineFor, repoFor, TREE } from "../../../plugins/jenkins/src/paths.ts";
import plugin from "../../../plugins/jenkins/src/server.ts";
import type { JenkinsJob, JenkinsRef } from "../../../plugins/jenkins/src/types.ts";
import { createLogger } from "../../../src/server/log.ts";
import { type ContextDeps, createContext } from "../../../src/server/plugins/context.ts";
import { Redactor } from "../../../src/server/secrets/redact.ts";
import { openStore } from "../../../src/server/store/db.ts";
import { createRepos } from "../../../src/server/store/repos.ts";
import { tmp } from "../../../tests/server/helpers.ts";
import { type FakeJenkins, type FakeJob, startFakeJenkins } from "./fakes/jenkins.ts";

const TOKEN = "jenkins-secret-token-1234";
const NOW = 1_780_000_000_000;

function job(
  base: string,
  pipeline: string,
  name: string,
  last: Partial<FakeJob["lastBuild"]> | null,
  success?: number,
): FakeJob {
  const url = `${base}${jobPath(pipeline)}/job/${encodeURIComponent(name)}/`;
  return {
    name,
    url,
    lastBuild: last && {
      number: 5,
      url: `${url}5/`,
      result: "SUCCESS",
      building: false,
      timestamp: NOW - 600_000,
      duration: 300_000,
      estimatedDuration: 320_000,
      ...last,
    },
    lastSuccessfulBuild: success ? { number: 4, timestamp: success, url: `${url}4/` } : null,
  };
}

const PIPELINES = ["acme/api", "web", "tools/cli"];
let fake: FakeJenkins;
let deps: ContextDeps;
let logs: string[];

beforeAll(async () => {
  const jobsFor = (base: string, p: string, i: number): FakeJob[] => [
    job(base, p, "main", {}, NOW - (i + 1) * 3_600_000),
    job(base, p, "PR-1", {}),
    job(base, p, "PR-2", { result: null, building: true, duration: 0 }),
    job(base, p, "PR-3", { result: "FAILURE" }),
    job(base, p, "PR-4", null),
  ];
  fake = await startFakeJenkins((base) => Object.fromEntries(PIPELINES.map((p, i) => [p, jobsFor(base, p, i)])));
  const redactor = new Redactor();
  logs = [];
  const repos = createRepos(openStore(`${tmp()}/j.db`).db);
  deps = {
    repos,
    env: new Map([["JENKINS_TOKEN", TOKEN]]),
    redactor,
    log: createLogger(redactor, { write: (s: string) => logs.push(s) } as never, "debug"),
    mock: false,
  };
});

afterAll(() => fake.close());
afterEach(() => {
  fake.requests.length = 0;
  fake.rateLimit = null;
});

const settingsFor = (extra: object = {}) =>
  plugin.settings.parse({
    baseUrl: `${fake.url}/`,
    user: "robot",
    token: { env: "JENKINS_TOKEN" },
    pipelines: { "acme/api": "acme/api", "acme/cli": "tools/cli" },
    ...extra,
  });

function ctx(
  opts: { settings?: object; scenario?: object; onScheduleNext?: (ms: number) => void; mock?: boolean } = {},
) {
  return createContext({ ...deps, mock: opts.mock ?? false }, "jenkins", {
    settings: settingsFor(opts.settings),
    timeoutMs: 5000,
    allowedEnv: ["JENKINS_TOKEN"],
    mockFaults: opts.scenario ? { scenario: opts.scenario as Record<string, unknown> } : undefined,
    onScheduleNext: opts.onScheduleNext,
  }) as PluginContext<never>;
}

const data = (r: unknown) => (r as { data: JenkinsJob }).data;

describe("jenkins pure helpers (T040)", () => {
  const s = { pipelines: { "acme/api": "folder/api-pipeline" }, pipelineTemplate: "{name}" };

  it("builds job paths and the tree", () => {
    expect(jobPath("a/b")).toBe("/job/a/job/b");
    expect(jobPath("my folder/x#y")).toBe("/job/my%20folder/job/x%23y");
    expect(TREE).toBe(
      "jobs[name,url,lastBuild[number,result,building,timestamp,duration,estimatedDuration,url],lastSuccessfulBuild[number,timestamp,url]]",
    );
  });

  it("maps repositories to pipelines and back", () => {
    expect(pipelineFor("acme/api", s)).toBe("folder/api-pipeline");
    expect(pipelineFor("acme/web", s)).toBe("web");
    expect(pipelineFor("acme/web", { pipelines: {}, pipelineTemplate: "{owner}/{name}-ci" })).toBe("acme/web-ci");
    expect(repoFor("folder/api-pipeline", s)).toBe("acme/api");
    expect(repoFor("web", s)).toBeUndefined(); // "{name}" alone cannot recover the owner
    expect(repoFor("acme/web-ci", { pipelines: {}, pipelineTemplate: "{owner}/{name}-ci" })).toBe("acme/web");
    expect(repoFor("acme/web", { pipelines: {}, pipelineTemplate: "{owner}/{name}-ci" })).toBeUndefined();
  });

  it("parses job names and URLs", () => {
    expect(parseJenkinsInput("a/b/PR-7")).toEqual({ ok: { pipeline: "a/b", job: "PR-7" } });
    expect(parseJenkinsInput("https://ci.example.com/job/a/job/b/job/PR-7/")).toEqual({
      ok: { pipeline: "a/b", job: "PR-7" },
    });
    expect(parseJenkinsInput("https://ci.example.com/jenkins/job/web/job/feature%252Fx/12/")).toEqual({
      ok: { pipeline: "web", job: "feature%2Fx" },
    });
    expect(parseJenkinsInput("PR-7")).toHaveProperty("error");
    expect(parseJenkinsInput("https://ci.example.com/view/all/")).toHaveProperty("error");
  });

  it("validates settings and references", () => {
    const s = settingsFor();
    expect(s).toMatchObject({ pipelineTemplate: "{name}", mainBranch: "main", runningRefreshInterval: "10s" });
    expect(plugin.settings.safeParse({ ...s, runningRefreshInterval: "soon" }).success).toBe(false);
    expect(plugin.settings.safeParse({ ...s, token: "literal" }).success).toBe(false);
    expect(plugin.reference.safeParse({ pipeline: "a", job: "" }).success).toBe(false);
    expect(plugin.refKey({ pipeline: "a/b", job: "PR-1" })).toBe("a/b/PR-1");
    expect(plugin.batchKey!(s, { pipeline: "a/b", job: "PR-1" })).toBe("a/b");
  });
});

describe("jenkins real source against a fake server (T038)", () => {
  const refs: JenkinsRef[] = PIPELINES.flatMap((pipeline) =>
    ["PR-1", "PR-2", "PR-3", "PR-4", "PR-99"].map((job) => ({ pipeline, job })),
  );

  it("makes one request per pipeline with Basic auth and maps every job", async () => {
    const s = settingsFor();
    const groups = Map.groupBy(refs, (r) => plugin.batchKey!(s, r));
    expect(groups.size).toBe(3);
    const scheduled: number[] = [];
    const results = new Map<string, unknown>();
    for (const group of groups.values()) {
      for (const [k, v] of await plugin.fetch(group, ctx({ onScheduleNext: (ms) => scheduled.push(ms) })))
        results.set(k, v);
    }
    expect(fake.requests).toHaveLength(3);
    expect(fake.requests.map((r) => r.pipeline).sort()).toEqual([...PIPELINES].sort());
    for (const r of fake.requests) {
      expect(r.tree).toBe(TREE);
      expect(r.headers.authorization).toBe(`Basic ${Buffer.from(`robot:${TOKEN}`).toString("base64")}`);
    }
    expect(fake.requests.find((r) => r.pipeline === "acme/api")?.path).toBe("/job/acme/job/api/api/json");
    expect(results.size).toBe(15);

    const ok = data(results.get("acme/api/PR-1"));
    expect(ok).toMatchObject({ pipeline: "acme/api", job: "PR-1", exists: true });
    expect(ok.build).toEqual({
      number: 5,
      url: `${fake.url}/job/acme/job/api/job/PR-1/5/`,
      result: "success",
      building: false,
      startedAt: NOW - 600_000,
      durationMs: 300_000,
      estimatedDurationMs: 320_000,
    });
    expect(ok.main).toEqual({
      branch: "main",
      lastSuccessAt: NOW - 3_600_000,
      url: `${fake.url}/job/acme/job/api/job/main/4/`,
    });
    expect(data(results.get("web/PR-1")).main.lastSuccessAt).toBe(NOW - 2 * 3_600_000);
    expect(data(results.get("tools/cli/PR-2")).build).toMatchObject({ building: true, result: null });
    expect(data(results.get("web/PR-3")).build?.result).toBe("failure");
    expect(data(results.get("web/PR-4"))).toMatchObject({ exists: true, build: null });
    expect(data(results.get("web/PR-99"))).toMatchObject({
      pipeline: "web",
      job: "PR-99",
      exists: false,
      build: null,
      url: `${fake.url}/job/web/job/PR-99/`,
      main: { branch: "main", lastSuccessAt: NOW - 2 * 3_600_000 },
    });
    expect(scheduled).toEqual([10_000, 10_000, 10_000]);
  });

  it("does not schedule a faster refresh when nothing runs, and reports main never succeeded", async () => {
    const scheduled: number[] = [];
    const res = await plugin.fetch(
      [{ pipeline: "web", job: "PR-1" }],
      ctx({ settings: { mainBranch: "trunk" }, onScheduleNext: (ms) => scheduled.push(ms) }),
    );
    expect(scheduled).toEqual([]);
    expect(data(res.get("web/PR-1")).main).toEqual({ branch: "trunk", lastSuccessAt: null, url: null });
  });

  it("reports an unknown pipeline per item", async () => {
    const res = await plugin.fetch([{ pipeline: "nope", job: "PR-1" }], ctx());
    expect(res.get("nope/PR-1")).toEqual({ error: "No Jenkins pipeline nope" });
  });

  it("throws a SourceError with retryAfterMs on 429, without leaking the token", async () => {
    fake.rateLimit = 30;
    const err = await plugin.fetch([{ pipeline: "web", job: "PR-1" }], ctx()).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 30_000 });
    expect(String(err.message)).not.toContain(TOKEN);
    expect(JSON.stringify(err)).not.toContain(TOKEN);
    const rerr = await Promise.resolve(
      plugin.resolvers!.jobForPullRequest!({ repo: "acme/web", number: 1 }, ctx()),
    ).catch((e: unknown) => e);
    expect(rerr).toMatchObject({ status: 429, retryAfterMs: 30_000 });
    expect(logs.join("")).not.toContain(TOKEN);
  });

  it("resolves the job for a pull request with one request", async () => {
    const r = plugin.resolvers!;
    expect(await r.jobForPullRequest!({ repo: "acme/api", number: 1 }, ctx())).toEqual({
      ok: { pipeline: "acme/api", job: "PR-1" },
    });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({ path: "/job/acme/job/api/api/json", tree: "jobs[name]" });
    expect(fake.requests[0]!.headers.authorization).toMatch(/^Basic /);
    expect(await r.jobForPullRequest!({ repo: "someone/web", number: 42 }, ctx())).toEqual({
      ok: { pipeline: "web", job: "PR-42" },
      pending: true,
    });
    expect(await r.jobForPullRequest!({ repo: "acme/missing", number: 1 }, ctx())).toEqual({
      error: "No Jenkins pipeline missing for acme/missing",
    });
    expect(fake.requests).toHaveLength(3);
    expect(await r.jobForPullRequest!({ repo: "bad", number: 1 }, ctx())).toHaveProperty("error");
  });

  it("maps a job back to its pull request", async () => {
    const r = plugin.resolvers!;
    expect(await r.pullRequestForJob!({ pipeline: "tools/cli", job: "PR-12" }, ctx())).toEqual({
      ok: { repo: "acme/cli", number: 12 },
    });
    expect(
      await r.pullRequestForJob!(
        { pipeline: "acme/web-ci", job: "PR-3" },
        ctx({ settings: { pipelineTemplate: "{owner}/{name}-ci" } }),
      ),
    ).toEqual({ ok: { repo: "acme/web", number: 3 } });
    expect(await r.pullRequestForJob!({ pipeline: "acme/api", job: "main" }, ctx())).toEqual({
      error: "Job main is not a pull request job (expected PR-<number>)",
    });
    expect(await r.pullRequestForJob!({ pipeline: "web", job: "PR-1" }, ctx())).toMatchObject({
      error: expect.stringContaining("does not map to a repository"),
    });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("jenkins mock source", () => {
  afterEach(() => vi.useRealTimers());
  const refs: JenkinsRef[] = Array.from({ length: 40 }, (_, i) => ({ pipeline: "web", job: `PR-${i + 1}` }));

  it("is deterministic and mostly successful, with running builds advancing", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const a = await plugin.mock.fetch(refs, ctx({ mock: true }));
    const b = await plugin.mock.fetch(refs, ctx({ mock: true }));
    expect([...a]).toEqual([...b]);
    const builds = [...a.values()].map((r) => data(r).build!);
    const success = builds.filter((x) => x.result === "success").length;
    expect(success).toBeGreaterThan(builds.length / 2);
    const running = builds.filter((x) => x.building);
    expect(running.length).toBeGreaterThan(0);
    for (const x of running) {
      expect(x.result).toBeNull();
      expect(x.startedAt).toBe(NOW - (NOW % x.estimatedDurationMs));
    }
    expect(builds.some((x) => x.result === "failure")).toBe(true);
    expect(data(a.get("web/PR-1")).main.lastSuccessAt).toEqual(expect.any(Number));
    expect(data(a.get("web/PR-1")).url).toBe(`${fake.url}/job/web/job/PR-1/`);
  });

  it("applies scenarios and schedules a faster refresh while running", async () => {
    const scenario = {
      running: ["web/PR-1"],
      failed: ["web/PR-2"],
      unstable: ["web/PR-3"],
      noBuild: ["web/PR-4"],
      noJob: ["web/PR-5"],
      mainNeverSucceeded: ["web"],
    };
    const scheduled: number[] = [];
    const res = await plugin.mock.fetch(
      refs.slice(0, 5),
      ctx({
        mock: true,
        scenario,
        settings: { runningRefreshInterval: "5s" },
        onScheduleNext: (ms) => scheduled.push(ms),
      }),
    );
    expect(data(res.get("web/PR-1")).build).toMatchObject({ building: true, result: null });
    expect(data(res.get("web/PR-2")).build?.result).toBe("failure");
    expect(data(res.get("web/PR-3")).build?.result).toBe("unstable");
    expect(data(res.get("web/PR-4"))).toMatchObject({ exists: true, build: null });
    expect(data(res.get("web/PR-5"))).toMatchObject({ exists: false, build: null });
    expect(data(res.get("web/PR-1")).main).toEqual({ branch: "main", lastSuccessAt: null, url: null });
    expect(scheduled).toEqual([5000]);

    const quiet: number[] = [];
    await plugin.mock.fetch(refs.slice(1, 2), ctx({ mock: true, scenario, onScheduleNext: (ms) => quiet.push(ms) }));
    expect(quiet).toEqual([]);
  });

  it("has resolvers that mirror the real rules", async () => {
    const r = plugin.mock.resolvers!;
    const c = ctx({ mock: true, scenario: { noJob: ["acme/api/PR-5"], unknownPipelines: ["missing"] } });
    expect(await r.jobForPullRequest!({ repo: "acme/api", number: 1 }, c)).toEqual({
      ok: { pipeline: "acme/api", job: "PR-1" },
    });
    expect(await r.jobForPullRequest!({ repo: "acme/api", number: 5 }, c)).toEqual({
      ok: { pipeline: "acme/api", job: "PR-5" },
      pending: true,
    });
    expect(await r.jobForPullRequest!({ repo: "acme/missing", number: 1 }, c)).toEqual({
      error: "No Jenkins pipeline missing for acme/missing",
    });
    expect(await r.pullRequestForJob!({ pipeline: "acme/api", job: "PR-9" }, c)).toEqual({
      ok: { repo: "acme/api", number: 9 },
    });
    expect(await r.pullRequestForJob!({ pipeline: "acme/api", job: "main" }, c)).toHaveProperty("error");
    expect(fake.requests).toHaveLength(0);
  });

  it("parses references offline", async () => {
    expect(await plugin.mock.parseReference("web/PR-1", ctx({ mock: true }))).toEqual({
      ok: { pipeline: "web", job: "PR-1" },
    });
  });
});

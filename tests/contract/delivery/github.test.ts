import { join } from "node:path";
import { type PluginContext, SourceError } from "@opsdash/plugin-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPrQuery, mapPrNode } from "../../../plugins/github/src/query.ts";
import plugin from "../../../plugins/github/src/server.ts";
import type { GithubPr, GithubRef, GithubSettings } from "../../../plugins/github/src/types.ts";
import { createLogger } from "../../../src/server/log.ts";
import { type ContextDeps, createContext } from "../../../src/server/plugins/context.ts";
import { Redactor } from "../../../src/server/secrets/redact.ts";
import { openStore } from "../../../src/server/store/db.ts";
import { createRepos } from "../../../src/server/store/repos.ts";
import { tmp } from "../../../tests/server/helpers.ts";
import { type FakeGithub, type FakePr, startFakeGithub } from "./fakes/github.ts";

const TOKEN = "ghp_contractTestToken0123456789";
const REPOS = ["acme/web", "acme/api", "acme/mobile"];

let fake: FakeGithub;
let deps: ContextDeps;
const logLines: string[] = [];

function ctx(settings: Partial<GithubSettings> = {}, mockFaults: object = {}): PluginContext<GithubSettings> {
  return createContext(deps, "github", {
    settings: plugin.settings.parse({ apiUrl: `${fake.url}/graphql`, token: { env: "GITHUB_TOKEN" }, ...settings }),
    timeoutMs: 5000,
    allowedEnv: ["GITHUB_TOKEN"],
    mockFaults: mockFaults as never,
  });
}

beforeAll(async () => {
  const prs: Record<string, FakePr> = {};
  for (const repo of REPOS) {
    for (let n = 1; n <= 10; n++) {
      prs[`${repo}#${n}`] = {
        title: `PROJ-${n}: change ${n}`,
        headRefName: `feature/PROJ-${n}`,
        reviewDecision: n % 2 ? "APPROVED" : "REVIEW_REQUIRED",
        checks: n % 3 ? "SUCCESS" : "FAILURE",
        isDraft: n === 4,
        state: n === 5 ? "MERGED" : "OPEN",
        mergedAt: n === 5 ? "2026-09-02T00:00:00Z" : null,
      };
    }
  }
  fake = await startFakeGithub(prs);
  const store = openStore(join(tmp(), "gh.db"));
  const redactor = new Redactor();
  deps = {
    repos: createRepos(store.db),
    env: new Map([["GITHUB_TOKEN", TOKEN]]),
    redactor,
    log: createLogger(redactor, { write: (s: string) => logLines.push(String(s)) } as never),
    mock: false,
  };
});

afterAll(() => fake.close());

const refs30: GithubRef[] = REPOS.flatMap((repo) => Array.from({ length: 10 }, (_, i) => ({ repo, number: i + 1 })));

describe("github real source against a fake GraphQL server (T038)", () => {
  it("fetches 30 pull requests across 3 repositories in exactly one request", async () => {
    fake.requests.length = 0;
    const res = await plugin.fetch(refs30, ctx());
    expect(fake.requests).toHaveLength(1);
    expect(res.size).toBe(30);
    const pr = (res.get("acme/api#5") as { data: GithubPr }).data;
    expect(pr).toMatchObject({ repo: "acme/api", number: 5, state: "merged", mergedAt: "2026-09-02T00:00:00Z" });
    expect((res.get("acme/web#4") as { data: GithubPr }).data).toMatchObject({
      state: "draft",
      review: "review_required",
      branch: "feature/PROJ-4",
    });
    expect((res.get("acme/web#3") as { data: GithubPr }).data.checks).toBe("failure");
    expect((res.get("acme/web#1") as { data: GithubPr }).data).toMatchObject({ review: "approved", checks: "success" });
  });

  it("sends a bearer token and the aliased query", async () => {
    fake.requests.length = 0;
    await plugin.fetch([{ repo: "acme/web", number: 1 }], ctx());
    const req = fake.requests[0]!;
    expect(req.method).toBe("POST");
    expect(req.headers.authorization).toBe(`bearer ${TOKEN}`);
    expect(JSON.parse(req.body).query).toContain('p0: repository(owner: "acme", name: "web") { pullRequest(number: 1)');
  });

  it("turns unknown pull requests into per-item errors", async () => {
    const res = await plugin.fetch(
      [
        { repo: "acme/web", number: 1 },
        { repo: "acme/web", number: 999 },
        { repo: "ghost/repo", number: 1 },
      ],
      ctx(),
    );
    expect(res.get("acme/web#1")).toHaveProperty("data");
    expect(res.get("acme/web#999")).toEqual({ error: "not found or no access" });
    expect(res.get("ghost/repo#1")).toEqual({ error: "not found or no access" });
  });

  it("throws a SourceError with retryAfterMs on 429, without leaking the token", async () => {
    fake.rateLimited = true;
    try {
      const err = await plugin.fetch(refs30, ctx()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SourceError);
      const e = err as SourceError;
      expect(e.message).toBe("GitHub rate limit reached");
      expect(e.status).toBe(429);
      expect(e.retryAfterMs).toBeGreaterThanOrEqual(30_000);
      expect(`${e.message} ${e.stack}`).not.toContain(TOKEN);
    } finally {
      fake.rateLimited = false;
    }
    expect(logLines.join("\n")).not.toContain(TOKEN);
  });

  it("parses references (real and mock)", async () => {
    for (const source of [plugin, plugin.mock]) {
      const c = ctx({ defaultRepo: "acme/web" });
      expect(await source.parseReference("acme/api#12", c)).toEqual({ ok: { repo: "acme/api", number: 12 } });
      expect(await source.parseReference("https://github.com/acme/api/pull/12", c)).toEqual({
        ok: { repo: "acme/api", number: 12 },
      });
      expect(await source.parseReference("https://ghe.corp.example/team/svc.x/pull/3/files", ctx())).toHaveProperty(
        "error",
      );
      expect(await source.parseReference("https://ghe.corp.example/team/svc.x/pull/3", c)).toEqual({
        ok: { repo: "team/svc.x", number: 3 },
      });
      expect(await source.parseReference("#7", c)).toEqual({ ok: { repo: "acme/web", number: 7 } });
      expect(await source.parseReference("#7", ctx())).toHaveProperty("error");
      expect(await source.parseReference("acme/api#0", c)).toHaveProperty("error");
      expect(await source.parseReference("acme#12", c)).toHaveProperty("error");
      expect(await source.parseReference("PROJ-12", c)).toHaveProperty("error");
    }
  });
});

describe("github query builders (T040)", () => {
  it("escapes strings and aliases in order", () => {
    const q = buildPrQuery([
      { repo: "a/b", number: 1 },
      { repo: 'x/y"z', number: 2 },
    ]);
    expect(q).toContain('p0: repository(owner: "a", name: "b") { pullRequest(number: 1)');
    expect(q).toContain('p1: repository(owner: "x", name: "y\\"z") { pullRequest(number: 2)');
    expect(q).toContain("commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }");
  });

  it("maps nodes", () => {
    const base = {
      title: "t",
      url: "u",
      isDraft: false,
      author: null,
      reviewDecision: null,
      headRefName: "b",
      mergedAt: null,
      closedAt: null,
      updatedAt: null,
    };
    const ref = { repo: "a/b", number: 1 };
    expect(mapPrNode({ ...base, state: "OPEN", isDraft: true }, ref)).toMatchObject({ state: "draft", checks: null });
    expect(mapPrNode({ ...base, state: "CLOSED" }, ref).state).toBe("closed");
    expect(
      mapPrNode(
        {
          ...base,
          state: "OPEN",
          reviewDecision: "CHANGES_REQUESTED",
          commits: { nodes: [{ commit: { statusCheckRollup: { state: "PENDING" } } }] },
        },
        ref,
      ),
    ).toMatchObject({ state: "open", review: "changes_requested", checks: "pending" });
  });
});

describe("github mock (T020)", () => {
  const ref = { repo: "acme/web", number: 1423 };
  const data = async (c: PluginContext<GithubSettings>, r: GithubRef = ref) =>
    ((await plugin.mock.fetch([r], c)).get(`${r.repo}#${r.number}`) as { data: GithubPr }).data;

  it("is deterministic and follows the story-key conventions", async () => {
    const a = await data(ctx());
    const b = await data(ctx());
    const { updatedAt: _a, ...restA } = a;
    const { updatedAt: _b, ...restB } = b;
    expect(restA).toEqual(restB);
    expect(a.title).toMatch(/^PROJ-65: \S/);
    expect(a.branch).toMatch(/^feature\/PROJ-65-[a-z0-9-]+$/);
    expect(a.url).toBe("https://github.com/acme/web/pull/1423");
    expect(["open", "draft"]).toContain(a.state);
    expect(a.mergedAt).toBeNull();
  });

  it("applies scenario overrides", async () => {
    const other = { repo: "acme/web", number: 7 };
    const c = ctx(
      {},
      {
        scenario: {
          merged: ["acme/web#1423"],
          closed: ["acme/web#7"],
          draft: ["acme/web#8"],
          changesRequested: ["acme/web#8"],
          failingChecks: ["acme/web#8"],
          mergedAgoDays: { "acme/web#9": 8 },
        },
      },
    );
    expect(await data(c)).toMatchObject({ state: "merged" });
    expect((await data(c)).mergedAt).not.toBeNull();
    expect(await data(c, other)).toMatchObject({ state: "closed", mergedAt: null });
    expect(await data(c, { repo: "acme/web", number: 8 })).toMatchObject({
      state: "draft",
      review: "changes_requested",
      checks: "failure",
    });
    const merged = await data(c, { repo: "acme/web", number: 9 });
    expect(merged.state).toBe("merged");
    const days = (Date.now() - Date.parse(merged.mergedAt!)) / 86_400_000;
    expect(days).toBeGreaterThan(7.99);
    expect(days).toBeLessThan(8.01);
  });
});

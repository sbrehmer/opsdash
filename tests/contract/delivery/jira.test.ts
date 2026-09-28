import { join } from "node:path";
import { MOCK_REQUESTS_KEY, type PluginContext, SourceError } from "@opsdash/plugin-sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import plugin from "../../../plugins/jira/src/server.ts";
import { mapIssue } from "../../../plugins/jira/src/source.ts";
import type { JiraSettings } from "../../../plugins/jira/src/types.ts";
import { createLogger } from "../../../src/server/log.ts";
import { type ContextDeps, createContext } from "../../../src/server/plugins/context.ts";
import { Redactor } from "../../../src/server/secrets/redact.ts";
import { openStore } from "../../../src/server/store/db.ts";
import { createRepos, type Repos } from "../../../src/server/store/repos.ts";
import { LogCapture, tmp } from "../../../tests/server/helpers.ts";
import { type FakeJira, jiraIssues, startFakeJira } from "./fakes/jira.ts";

const TOKEN = "jira-secret-token-9f3c2a";
const EMAIL = "bot@example.com";

let fake: FakeJira;
let repos: Repos;
let logs: LogCapture;

function deps(mock: boolean): ContextDeps {
  const redactor = new Redactor();
  return { repos, env: new Map([["JIRA_TOKEN", TOKEN]]), redactor, log: createLogger(redactor, logs), mock };
}

function ctx(
  settings: Record<string, unknown>,
  opts: { mock?: boolean; scenario?: Record<string, unknown> } = {},
): PluginContext<JiraSettings> {
  return createContext(deps(opts.mock ?? false), "jira", {
    settings: plugin.settings.parse({ token: { env: "JIRA_TOKEN" }, ...settings }) as JiraSettings,
    timeoutMs: 5000,
    allowedEnv: ["JIRA_TOKEN"],
    mockFaults: opts.scenario ? { scenario: opts.scenario } : undefined,
  });
}

const cloud = () => ctx({ deployment: "cloud", baseUrl: `${fake.url}/`, email: EMAIL });
const datacenter = () => ctx({ deployment: "datacenter", baseUrl: fake.url });
const keys = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `PROJ-${i + 1}` }));

beforeAll(async () => {
  fake = await startFakeJira(jiraIssues(40));
  repos = createRepos(openStore(join(tmp(), "jira.db")).db);
});
afterAll(() => fake.close());
beforeEach(() => {
  fake.requests.length = 0;
  fake.rateLimit = null;
  logs = new LogCapture();
});

describe("mapIssue", () => {
  it("maps fields, status categories and a missing assignee", () => {
    const issue = (key: string, cat: string, assignee: { displayName: string } | null) => ({
      key,
      fields: { summary: "Fix it", status: { name: "Whatever", statusCategory: { key: cat } }, assignee },
    });
    expect(mapIssue(issue("A-1", "new", { displayName: "Ada" }), "https://j.example")).toEqual({
      key: "A-1",
      url: "https://j.example/browse/A-1",
      title: "Fix it",
      status: "Whatever",
      category: "todo",
      assignee: "Ada",
    });
    expect(mapIssue(issue("A-2", "indeterminate", null), "https://j").category).toBe("inprogress");
    expect(mapIssue(issue("A-3", "done", null), "https://j")).toMatchObject({ category: "done", assignee: null });
  });
});

describe("real Jira source against a fake server (T038, SC-002, SC-007)", () => {
  it("Cloud: 30 keys → one bulkfetch request with Basic auth and the right body", async () => {
    const res = await plugin.fetch(keys(30), cloud());
    expect(fake.requests).toHaveLength(1);
    const [req] = fake.requests;
    expect(req!.method).toBe("POST");
    expect(req!.path).toBe("/rest/api/3/issue/bulkfetch");
    expect(req!.headers.authorization).toBe(`Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`);
    expect(req!.body).toEqual({
      issueIdsOrKeys: keys(30).map((r) => r.key),
      fields: ["summary", "status", "assignee"],
    });
    expect(res.size).toBe(30);
    expect(res.get("PROJ-1")).toEqual({
      data: {
        key: "PROJ-1",
        url: `${fake.url}/browse/PROJ-1`,
        title: "Issue 1",
        status: "To Do",
        category: "todo",
        assignee: null,
      },
    });
    expect(res.get("PROJ-2")).toMatchObject({ data: { category: "inprogress", assignee: "Person 1" } });
    expect(res.get("PROJ-3")).toMatchObject({ data: { status: "Done", category: "done" } });
  });

  it("Data Center: 30 keys → one search request with Bearer auth and key-in JQL", async () => {
    const res = await plugin.fetch(keys(30), datacenter());
    expect(fake.requests).toHaveLength(1);
    const [req] = fake.requests;
    expect(req!.path).toBe("/rest/api/2/search");
    expect(req!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(req!.body).toEqual({
      jql: `key in (${keys(30)
        .map((r) => r.key)
        .join(",")})`,
      fields: ["summary", "status", "assignee"],
      maxResults: 30,
      validateQuery: "warn",
    });
    expect(res.size).toBe(30);
    expect(res.get("PROJ-30")).toMatchObject({ data: { key: "PROJ-30", url: `${fake.url}/browse/PROJ-30` } });
  });

  it.each([
    ["cloud", cloud],
    ["datacenter", datacenter],
  ])("%s: unknown keys become per-item errors", async (_name, make) => {
    const res = await plugin.fetch([{ key: "PROJ-1" }, { key: "NOPE-1" }, { key: "PROJ-999" }], make());
    expect(fake.requests).toHaveLength(1);
    expect(res.get("PROJ-1")).toHaveProperty("data");
    expect(res.get("NOPE-1")).toEqual({ error: "not found or no access" });
    expect(res.get("PROJ-999")).toEqual({ error: "not found or no access" });
  });

  it.each([
    ["cloud", cloud],
    ["datacenter", datacenter],
  ])("%s: 429 → SourceError with retryAfterMs, token never leaks", async (_name, make) => {
    fake.rateLimit = 30;
    const c = make();
    const err = await plugin.fetch(keys(3), c).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ status: 429, retryAfterMs: 30_000, message: "Jira rate limit reached" });
    c.log.error({ err }, "refresh failed");
    const text = `${(err as Error).message} ${(err as Error).stack} ${JSON.stringify(err)} ${logs.raw}`;
    expect(logs.raw).toContain("refresh failed");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64"));
  });

  it("other HTTP errors carry no credentials", async () => {
    const c = ctx({ deployment: "datacenter", baseUrl: `${fake.url}/wrong` });
    const err = (await plugin.fetch(keys(1), c).catch((e: unknown) => e)) as SourceError;
    expect(err).toMatchObject({ status: 404, message: "Jira responded 404" });
    expect(`${err.stack}${logs.raw}`).not.toContain(TOKEN);
  });
});

describe("Jira mock source (T019)", () => {
  const mctx = (scenario?: Record<string, unknown>) =>
    ctx({ deployment: "datacenter", baseUrl: "https://jira.example/" }, { mock: true, scenario });

  it("is deterministic, batched and uses the /browse/ URL", async () => {
    const before = (repos.stateGet("jira", MOCK_REQUESTS_KEY) as number | undefined) ?? 0;
    const a = await plugin.mock.fetch(keys(30), mctx());
    const b = await plugin.mock.fetch(keys(30), mctx());
    expect(repos.stateGet("jira", MOCK_REQUESTS_KEY)).toBe(before + 2);
    expect(a.size).toBe(30);
    expect([...a]).toEqual([...b]);
    const item = (a.get("PROJ-7") as { data: Record<string, unknown> }).data;
    expect(item).toMatchObject({ key: "PROJ-7", url: "https://jira.example/browse/PROJ-7" });
    expect(["To Do", "In Progress", "In Review", "Done"]).toContain(item.status);
    expect(["todo", "inprogress", "done"]).toContain(item.category);
    expect(fake.requests).toHaveLength(0);
  });

  it("scenario.status overrides the seeded status and its category", async () => {
    const res = await plugin.mock.fetch(
      [{ key: "PROJ-1" }, { key: "PROJ-2" }],
      mctx({ status: { "PROJ-1": "In Review", "PROJ-2": "Done" } }),
    );
    expect(res.get("PROJ-1")).toMatchObject({ data: { status: "In Review", category: "inprogress" } });
    expect(res.get("PROJ-2")).toMatchObject({ data: { status: "Done", category: "done" } });
  });

  it("parses keys and /browse/ URLs and rejects bad input", async () => {
    const c = mctx();
    for (const source of [plugin, plugin.mock]) {
      expect(await source.parseReference!("PROJ-88", c)).toEqual({ ok: { key: "PROJ-88" } });
      expect(await source.parseReference!(" proj-88 ", c)).toEqual({ ok: { key: "PROJ-88" } });
      expect(await source.parseReference!("https://acme.atlassian.net/browse/AB_C-12?focus=1", c)).toEqual({
        ok: { key: "AB_C-12" },
      });
      for (const bad of ["", "PROJ", "88", "P-1", "https://acme.atlassian.net/projects/PROJ"]) {
        expect(await source.parseReference!(bad, c)).toMatchObject({ error: expect.stringContaining("PROJ-88") });
      }
    }
  });

  it("validates settings and references", () => {
    const base = { baseUrl: "https://jira.example", token: { env: "JIRA_TOKEN" } };
    expect(plugin.settings.safeParse({ ...base, deployment: "cloud" }).success).toBe(false);
    expect(plugin.settings.safeParse({ ...base, deployment: "cloud", email: EMAIL }).success).toBe(true);
    expect(plugin.settings.parse({ ...base, deployment: "datacenter" })).toMatchObject({ projectKeys: [] });
    expect(plugin.settings.safeParse({ ...base, deployment: "server" }).success).toBe(false);
    expect(plugin.reference.safeParse({ key: "PROJ-1" }).success).toBe(true);
    expect(plugin.reference.safeParse({ key: "proj-1" }).success).toBe(false);
    expect(plugin.refKey({ key: "PROJ-1" })).toBe("PROJ-1");
  });
});

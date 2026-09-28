import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type DefinedPlugin, MOCK_REQUESTS_KEY, PLUGIN_API_VERSION, type PluginContext } from "@opsdash/plugin-sdk";
import semver from "semver";
import { beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../../../src/server/log.ts";
import { type ContextDeps, createContext } from "../../../src/server/plugins/context.ts";
import { checkManifest } from "../../../src/server/plugins/manifest.ts";
import { Redactor } from "../../../src/server/secrets/redact.ts";
import { openStore } from "../../../src/server/store/db.ts";
import { createRepos, type Repos } from "../../../src/server/store/repos.ts";
import { tmp } from "../../../tests/server/helpers.ts";
import { ROOT } from "../helpers.ts";

interface Case {
  id: string;
  env: string[];
  settings: Record<string, unknown>;
  /** Two valid references, a user input that parses to the first, and one that must be rejected. */
  refs: [unknown, unknown];
  keys: [string, string];
  input: string;
  bad: string;
}

const CASES: Case[] = [
  {
    id: "reference",
    env: ["REFERENCE_TOKEN"],
    settings: {},
    refs: [{ key: "ITEM-1" }, { key: "ITEM-2" }],
    keys: ["ITEM-1", "ITEM-2"],
    input: "ITEM-1",
    bad: "nope",
  },
  {
    id: "jira",
    env: ["JIRA_TOKEN"],
    settings: {
      deployment: "cloud",
      baseUrl: "https://jira.example.com",
      email: "me@example.com",
      token: { env: "JIRA_TOKEN" },
    },
    refs: [{ key: "PROJ-1" }, { key: "PROJ-2" }],
    keys: ["PROJ-1", "PROJ-2"],
    input: "PROJ-1",
    bad: "not a key",
  },
  {
    id: "github",
    env: ["GITHUB_TOKEN"],
    settings: { token: { env: "GITHUB_TOKEN" } },
    refs: [
      { repo: "acme/web", number: 1 },
      { repo: "acme/web", number: 2 },
    ],
    keys: ["acme/web#1", "acme/web#2"],
    input: "acme/web#1",
    bad: "not a pr",
  },
  {
    id: "jenkins",
    env: ["JENKINS_TOKEN"],
    settings: {
      baseUrl: "https://ci.example.com",
      user: "bot",
      token: { env: "JENKINS_TOKEN" },
      pipelineTemplate: "acme/{name}",
      defaultOwner: "acme",
    },
    refs: [
      { pipeline: "acme/web", job: "PR-1" },
      { pipeline: "acme/web", job: "PR-2" },
    ],
    keys: ["acme/web/PR-1", "acme/web/PR-2"],
    input: "acme/web/PR-1",
    bad: "",
  },
];

const dir = (id: string) => join(ROOT, "plugins", id);
const load = async (id: string): Promise<DefinedPlugin> =>
  (await import(pathToFileURL(join(dir(id), "dist/server.js")).href)).default;

let repos: Repos;
let deps: ContextDeps;
beforeAll(() => {
  repos = createRepos(openStore(join(tmp(), "plugins.db")).db);
  const redactor = new Redactor();
  deps = { repos, env: new Map(), redactor, log: createLogger(redactor, { write() {} } as never), mock: true };
});

describe.each(CASES)("$id plugin (mock mode, API 1.1)", (c) => {
  let plugin: DefinedPlugin;
  beforeAll(async () => {
    plugin = await load(c.id);
  });
  const ctx = (o: { mockFaults?: object; timeoutMs?: number; pluginId?: string } = {}): PluginContext =>
    createContext(deps, o.pluginId ?? c.id, {
      settings: plugin.settings.parse(c.settings),
      timeoutMs: o.timeoutMs ?? 5000,
      allowedEnv: c.env,
      mockFaults: o.mockFaults as never,
    });

  it("has a valid manifest compatible with API 1.1.0", () => {
    const check = checkManifest(dir(c.id));
    expect(check.ok).toBe(true);
    const m = check.ok ? check.manifest : undefined;
    expect(m!.id).toBe(c.id);
    expect(semver.satisfies("1.1.0", m!.apiVersion)).toBe(true);
    expect(semver.satisfies(PLUGIN_API_VERSION, m!.apiVersion)).toBe(true);
    expect(m).toMatchObject({ hasMock: true, capabilities: ["track"], env: c.env });
    expect(m!.settingsSchema).toMatchObject({ type: "object" });
    expect(m!.referenceSchema).toMatchObject({ type: "object" });
    expect(m!.composes).toBeUndefined();
  });

  it("validates references and computes ref keys", () => {
    for (const [i, ref] of c.refs.entries()) {
      expect(plugin.reference.safeParse(ref).success).toBe(true);
      expect(plugin.refKey(ref)).toBe(c.keys[i]);
    }
    expect(plugin.reference.safeParse({}).success).toBe(false);
  });

  it("parses input into a reference and rejects bad input", async () => {
    const ok = await plugin.mock.parseReference(c.input, ctx());
    expect(ok).toHaveProperty("ok");
    expect(plugin.refKey((ok as { ok: unknown }).ok)).toBe(c.keys[0]);
    expect(await plugin.mock.parseReference(c.bad, ctx())).toHaveProperty("error");
  });

  it("returns deterministic mock data in one request per batch", async () => {
    const before = (repos.stateGet(c.id, MOCK_REQUESTS_KEY) as number | undefined) ?? 0;
    const a = await plugin.mock.fetch(c.refs, ctx());
    const b = await plugin.mock.fetch(c.refs, ctx());
    expect(repos.stateGet(c.id, MOCK_REQUESTS_KEY)).toBe(before + 2);
    expect([...a.keys()].sort()).toEqual([...c.keys].sort());
    for (const key of c.keys) {
      expect(a.get(key)).toHaveProperty("data");
      // Timestamps are relative to "now"; compare everything else.
      const strip = (r: unknown) => JSON.parse(JSON.stringify(r), (k, v) => (k.endsWith("At") ? undefined : v));
      expect(strip(b.get(key))).toEqual(strip(a.get(key)));
    }
  });

  it("reports partial errors through errorKeys", async () => {
    const res = await plugin.mock.fetch(c.refs, ctx({ mockFaults: { errorKeys: [c.keys[1]] } }));
    expect(res.get(c.keys[0])).toHaveProperty("data");
    expect(res.get(c.keys[1])).toEqual({ error: `Simulated error for ${c.keys[1]}` });
  });

  it("honours ctx.signal", async () => {
    const started = Date.now();
    await expect(
      plugin.mock.fetch([c.refs[0]], ctx({ timeoutMs: 100, mockFaults: { latencyMs: 10_000 } })),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("keeps state in its own namespace", () => {
    ctx().state.set("isolation", c.id);
    expect(ctx({ pluginId: `${c.id}-other` }).state.get("isolation")).toBeUndefined();
  });
});

describe("delivery plugin manifest (composite, API 1.1)", () => {
  it("is a valid composite with settings and no source", async () => {
    const check = checkManifest(dir("delivery"));
    expect(check.ok).toBe(true);
    const m = check.ok ? check.manifest : undefined;
    expect(m!.id).toBe("delivery");
    expect(semver.satisfies("1.1.0", m!.apiVersion)).toBe(true);
    expect(m!.settingsSchema).toMatchObject({ type: "object" });
    expect(m!.referenceSchema).toBeUndefined();
    expect([...m!.composes!].sort()).toEqual(["github", "jenkins", "jira"]);
    expect(m!.capabilities).toContain("actions");
    const plugin = (await load("delivery")) as unknown as {
      settings: DefinedPlugin["settings"];
      mock?: unknown;
      fetch?: unknown;
    };
    expect(plugin.settings.parse({})).toEqual({ retention: "7d" });
    expect(plugin.fetch).toBeUndefined();
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type DefinedPlugin, MOCK_REQUESTS_KEY, PLUGIN_API_VERSION, type PluginContext } from "@opsdash/plugin-sdk";
import semver from "semver";
import { beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../../packages/host/src/log.ts";
import { type ContextDeps, createContext } from "../../packages/host/src/plugins/context.ts";
import { checkManifest } from "../../packages/host/src/plugins/manifest.ts";
import { Redactor } from "../../packages/host/src/secrets/redact.ts";
import { openStore } from "../../packages/host/src/store/db.ts";
import { createRepos, type Repos } from "../../packages/host/src/store/repos.ts";
import { tmp } from "../../packages/host/tests/helpers.ts";
import { ROOT } from "./helpers.ts";

const DIR = join(ROOT, "plugins/reference");
let plugin: DefinedPlugin;
let repos: Repos;
let deps: ContextDeps;

const ctx = (opts: Partial<{ timeoutMs: number; mockFaults: object; pluginId: string }> = {}): PluginContext =>
  createContext(deps, opts.pluginId ?? "reference", {
    settings: plugin.settings.parse({}),
    timeoutMs: opts.timeoutMs ?? 5000,
    allowedEnv: ["REFERENCE_TOKEN"],
    mockFaults: opts.mockFaults,
  });

beforeAll(async () => {
  plugin = (await import(pathToFileURL(join(DIR, "dist/server.js")).href)).default;
  const store = openStore(join(tmp(), "c.db"));
  repos = createRepos(store.db);
  const redactor = new Redactor();
  deps = { repos, env: new Map(), redactor, log: createLogger(redactor, { write() {} } as never), mock: true };
});

describe("plugin API contract v1 against the reference plugin (FR-044)", () => {
  it("has a complete, compatible manifest", () => {
    const check = checkManifest(DIR);
    expect(check.ok).toBe(true);
    const m = check.ok ? check.manifest : undefined;
    expect(semver.satisfies(PLUGIN_API_VERSION, m!.apiVersion)).toBe(true);
    expect(m).toMatchObject({ id: "reference", hasMock: true, capabilities: ["track"], env: ["REFERENCE_TOKEN"] });
    expect(m!.settingsSchema).toMatchObject({ type: "object" });
    expect(m!.referenceSchema).toMatchObject({ type: "object" });
    const pkg = JSON.parse(readFileSync(join(DIR, "package.json"), "utf8"));
    expect(m!.version).toBe(pkg.version);
  });

  it("validates settings, references and ref keys", () => {
    expect(plugin.settings.safeParse({ view: "grid" }).success).toBe(false);
    expect(plugin.settings.parse({})).toEqual({ view: "list", items: [] });
    expect(plugin.reference.safeParse({ key: "ITEM-1" }).success).toBe(true);
    expect(plugin.reference.safeParse({ key: "nope" }).success).toBe(false);
    expect(plugin.refKey({ key: "ITEM-9" })).toBe("ITEM-9");
  });

  it("resolves a 25-ref batch in a single call", async () => {
    const refs = Array.from({ length: 25 }, (_, i) => ({ key: `ITEM-${i + 1}` }));
    const c = ctx();
    const before = (repos.stateGet("reference", MOCK_REQUESTS_KEY) as number) ?? 0;
    const res = await plugin.mock.fetch(refs, c);
    expect(res.size).toBe(25);
    expect(repos.stateGet("reference", MOCK_REQUESTS_KEY)).toBe(before + 1);
  });

  it("returns partial results per ref", async () => {
    const res = await plugin.mock.fetch(
      [{ key: "ITEM-1" }, { key: "ITEM-2" }],
      ctx({ mockFaults: { errorKeys: ["ITEM-2"] } }),
    );
    expect(res.get("ITEM-1")).toHaveProperty("data");
    expect(res.get("ITEM-2")).toEqual({ error: "Simulated error for ITEM-2" });
  });

  it("honours ctx.signal on timeout", async () => {
    const started = Date.now();
    await expect(
      plugin.mock.fetch([{ key: "ITEM-1" }], ctx({ timeoutMs: 100, mockFaults: { latencyMs: 10_000 } })),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("parses user input into references or explains the problem", async () => {
    expect(await plugin.mock.parseReference("ITEM-42", ctx())).toEqual({ ok: { key: "ITEM-42" } });
    expect(await plugin.mock.parseReference("bad", ctx())).toMatchObject({
      error: expect.stringContaining("ITEM-123"),
    });
    expect(await plugin.mock.parseReference("ITEM-404", ctx({ mockFaults: { notFound: ["ITEM-404"] } }))).toEqual({
      error: "ITEM-404 was not found",
    });
    expect(await plugin.parseReference("ITEM-1", ctx())).toEqual({ ok: { key: "ITEM-1" } });
  });

  it("mock data is deterministic for the same ref key", async () => {
    const a = (await plugin.mock.fetch([{ key: "ITEM-3" }], ctx())).get("ITEM-3") as {
      data: { title: string; status: string };
    };
    const b = (await plugin.mock.fetch([{ key: "ITEM-3" }], ctx())).get("ITEM-3") as {
      data: { title: string; status: string };
    };
    expect(a.data.title).toBe(b.data.title);
    expect(a.data.status).toBe(b.data.status);
  });

  it("isolates plugin state per namespace", () => {
    ctx().state.set("k", 1);
    expect(ctx({ pluginId: "other" }).state.get("k")).toBeUndefined();
  });

  it("creates, lists and cascades links through the host", () => {
    const a = repos.trackRef("x/a", "reference", "ITEM-1", { key: "ITEM-1" });
    const b = repos.trackRef("x/b", "other", "PR-1", { n: 1 });
    const c = ctx();
    c.links.create(a.id, b.id);
    expect(c.links.list(b.id)).toEqual([{ fromRefId: a.id, toRefId: b.id, createdBy: "reference" }]);
    expect(c.refs.find("other", "PR-1")).toHaveLength(1);
    repos.untrackRef("x/b", "PR-1");
    expect(c.links.list(a.id)).toEqual([]);
  });

  it("the real source needs its secret and batches too", async () => {
    await expect(plugin.fetch([{ key: "ITEM-1" }], ctx())).rejects.toThrow(/REFERENCE_TOKEN missing/);
    deps.env.set("REFERENCE_TOKEN", "t0ken-value");
    const res = await plugin.fetch([{ key: "ITEM-1" }, { key: "ITEM-2" }], ctx());
    expect(res.size).toBe(2);
    expect(repos.stateGet("reference", "__source.requests")).toBe(1);
    deps.env.delete("REFERENCE_TOKEN");
  });
});

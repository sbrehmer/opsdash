import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkManifest } from "../../../src/server/plugins/manifest.ts";
import { type Harness, sse, start, tmp, writeConfig } from "../../../tests/server/helpers.ts";
import { type Api11Probe, resetProbe, writeApi11Plugins } from "../../fixtures/plugins/api11.ts";
import { copyReference } from "../../fixtures/plugins/variants.ts";
import { ROOT } from "../helpers.ts";

const CONFIG = `version: 1
plugins:
  src1:
    version: "^1.1.0"
    cacheWindow: 0s
    settings: { level: plugin }
  comp:
    version: "^1.1.0"
dashboards:
  - id: main
    title: Main
    items:
      - id: s
        plugin: src1
        title: Source
        at: [1, 1]
        size: [6, 4]
        settings: { level: widget }
      - id: c
        plugin: comp
        title: Composite
        at: [7, 1]
        size: [6, 4]
        settings: { view: board }
`;

const S = "main/s";
const C = "main/c";

let h: Harness | undefined;
let pluginsDir: string;
let probe: Api11Probe;

beforeEach(() => {
  pluginsDir = tmp("opsdash-api11-plugins-");
  writeApi11Plugins(pluginsDir);
  copyReference(pluginsDir);
  probe = resetProbe();
});

afterEach(async () => {
  await h?.close();
  h = undefined;
});

const boot = async (timers = false) => {
  h = await start({ configDir: writeConfig({ "opsdash.yaml": CONFIG }), pluginsDir, mock: true, timers });
  return h;
};

const action = (path: string, name: string, payload: unknown = {}) =>
  fetch(`${h!.ops.url}/api/widgets/${encodeURIComponent(path)}/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const add = async (k: string) => {
  const res = await action(C, "add", { k });
  expect(res.status).toBe(200);
  return Number(((await res.json()) as { message: string }).message);
};

describe("plugin API 1.1 host behaviour (T006)", () => {
  it("(a) fetches a composite widget's refs in the owning plugin's batch and assembles items, links and meta", async () => {
    await boot();
    h!.ops.repos.trackRef(S, "src1", "a:1", { k: "a:1" });
    const id2 = await add("a:2");
    const id3 = await add("a:3");
    await h!.ops.scheduler.idle();
    probe.calls.length = 0;

    const s = await sse(h!.ops.url, "main");
    const data = await s.waitFor((e) => e.event === "widget-data" && e.data.path === C && e.data.state === "ok");
    await h!.ops.scheduler.idle();

    // One src1 batch (batch key "a") serves both src1's own widget and the composite widget.
    expect(probe.calls).toHaveLength(1);
    expect([...probe.calls[0]!.keys].sort()).toEqual(["a:1", "a:2", "a:3"]);
    expect(data.data.items).toEqual([
      expect.objectContaining({ plugin: "src1", id: id2, refKey: "a:2", data: { k: "a:2" }, state: "ok" }),
      expect.objectContaining({ plugin: "src1", id: id3, refKey: "a:3", data: { k: "a:3" }, state: "ok" }),
    ]);
    expect(data.data.links).toEqual([{ from: id2, to: id3 }]);
    expect(data.data.meta).toEqual({ n: 2 });
    const own = h!.ops.scheduler.latest(S)!;
    expect(own.items).toEqual([expect.objectContaining({ plugin: "src1", refKey: "a:1", data: { k: "a:1" } })]);
    s.close();
  });

  it("(b) runs ctx.plugins.resolve with the target plugin's plugin-level settings", async () => {
    await boot();
    const res = await action(C, "echo", { x: 1 });
    expect(res.status).toBe(200);
    const { message } = (await res.json()) as { message: string };
    expect(JSON.parse(message)).toEqual({ input: { x: 1 }, settings: { level: "plugin" } });
  });

  it("(c) ctx.scheduleNext(50) brings the next tick forward to about 50 ms, once", async () => {
    await boot(true);
    expect(h!.ops.scheduler.nextDelay.get("src1")).toBe(60_000);
    h!.ops.repos.trackRef(S, "src1", "a:1", { k: "a:1" });
    probe.scheduleNext = 50;

    const s = await sse(h!.ops.url, "main");
    const deadline = Date.now() + 3000;
    while (probe.calls.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    expect(probe.calls.length).toBeGreaterThanOrEqual(2);
    const gap = probe.calls[1]!.at - probe.calls[0]!.at;
    expect(gap).toBeGreaterThanOrEqual(45);
    expect(gap).toBeLessThan(1000);
    await h!.ops.scheduler.idle();
    // Once: the tick after that is back on the plugin's interval.
    expect(h!.ops.scheduler.nextDelay.get("src1")).toBe(60_000);
    await new Promise((r) => setTimeout(r, 300));
    expect(probe.calls).toHaveLength(2);
    const cycles = h!.logs.events("refresh.cycle").filter((l) => l.plugin === "src1");
    expect(cycles.filter((l) => l.nextInMs === 50)).toHaveLength(1);
    s.close();
  });

  it("(d) groups by batchKey(settings, ref) per reference", async () => {
    await boot();
    await add("a:1");
    await add("b:1");
    await h!.ops.scheduler.idle();
    probe.calls.length = 0;

    const s = await sse(h!.ops.url, "main");
    await s.waitFor((e) => e.event === "widget-data" && e.data.path === C && e.data.state === "ok");
    await h!.ops.scheduler.idle();
    expect(probe.calls.map((c) => c.keys).sort()).toEqual([["a:1"], ["b:1"]]);
    for (const c of probe.calls) expect(c.settings).toEqual({ level: "plugin" });
    s.close();
  });

  it("(e) routes actions with status codes 200, 422, 404 and 400", async () => {
    await boot();
    expect((await action(C, "add", { k: "a:1" })).status).toBe(200);
    const invalid = await action(C, "add", {});
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ error: "A key is required" });
    expect((await action(C, "nope")).status).toBe(404);
    expect((await action("main/missing", "add", { k: "a:1" })).status).toBe(404);
    const noCapability = await action(S, "add", { k: "a:1" });
    expect(noCapability.status).toBe(400);
    expect((await noCapability.json()).error).toMatch(/does not support actions/);
  });

  it("(f) untrack with ?plugin=&cascade=1 removes unlinked leftovers", async () => {
    await boot();
    const a = await add("a:1");
    const b = await add("a:2");
    const c = await add("a:3"); // links: a -> b -> c
    const del = (refKey: string) =>
      fetch(
        `${h!.ops.url}/api/widgets/${encodeURIComponent(C)}/items/${encodeURIComponent(refKey)}?plugin=src1&cascade=1`,
        { method: "DELETE" },
      );
    const ids = () => h!.ops.repos.listRefs(C).map((r) => r.id);

    // b is still linked to c, so it stays.
    expect((await del("a:1")).status).toBe(204);
    expect(ids()).toEqual([b, c]);
    // b is left without links, so it goes with c.
    expect((await del("a:3")).status).toBe(204);
    expect(ids()).toEqual([]);
    expect(ids()).not.toContain(a);
    expect((await del("a:3")).status).toBe(404);
  });

  it("(g) still loads the API 1.0 reference plugin next to 1.1 plugins", async () => {
    await boot();
    expect(h!.ops.registry.get("reference")?.state).toBe("loaded");
    expect(h!.ops.registry.get("src1")?.state).toBe("loaded");
    expect(h!.ops.registry.get("comp")?.state).toBe("loaded");
  });

  it("(g) plugin-api.test.ts passes unchanged (FR-029)", () => {
    const run = spawnSync(
      "pnpm",
      ["exec", "vitest", "run", "--project", "contract", "tests/contract/plugin-api.test.ts"],
      { cwd: ROOT, encoding: "utf8", env: { ...process.env, CI: "1" } },
    );
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });

  it("(h) an empty composite widget publishes state empty on subscribe", async () => {
    await boot();
    const s = await sse(h!.ops.url, "main");
    const snapshot = s.events.find((e) => e.event === "snapshot")!;
    const widget = snapshot.data.widgets.find((w: { path: string }) => w.path === C);
    expect(widget).toMatchObject({ path: C, state: "empty", items: [], links: [], meta: { n: 0 } });
    s.close();
  });

  it("(i) fetches the new ref and publishes composite data straight after an action, without a timer", async () => {
    await boot(false);
    const s = await sse(h!.ops.url, "main");
    await h!.ops.scheduler.idle();
    probe.calls.length = 0;

    const id = await add("a:9");
    const got = await s.waitFor(
      (e) =>
        e.event === "widget-data" &&
        e.data.path === C &&
        e.data.items.some((i: { refKey: string; data?: unknown }) => i.refKey === "a:9" && i.data),
    );
    expect(got.data.items).toEqual([expect.objectContaining({ plugin: "src1", id, data: { k: "a:9" } })]);
    expect(probe.calls.map((c) => c.keys)).toEqual([["a:9"]]);
    s.close();
  });

  it("(j) refuses a composite manifest without settingsSchema", async () => {
    const check = checkManifest(join(pluginsDir, "comp-bare"));
    expect(check).toMatchObject({ ok: false, reason: expect.stringMatching(/settingsSchema/) });
    expect(checkManifest(join(pluginsDir, "comp")).ok).toBe(true);
    await boot();
    expect(h!.ops.registry.get("comp-bare")).toBeUndefined();
    expect(h!.ops.registry.refusedById("comp-bare")?.refusal).toMatch(/missing required field\(s\): settingsSchema/);
  });
});

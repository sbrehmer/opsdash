import { afterEach, describe, expect, it } from "vitest";
import { copyReference, writeVariants } from "../../../../tests/fixtures/plugins/variants.ts";
import { type Harness, refConfig, sse, start, tmp, writeConfig } from "../helpers.ts";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const widget = (id: string, plugin: string, col: number, row = 1) =>
  `      - { id: ${id}, plugin: ${plugin}, at: [${col}, ${row}], size: [3, 2], settings: { items: ["ITEM-1"] } }`;

describe("plugin loading and isolation (US3)", () => {
  it("refuses bad plugins with a reason and isolates runtime failures", async () => {
    const pluginsDir = tmp("opsdash-plugins-");
    writeVariants(pluginsDir);
    copyReference(pluginsDir);
    const configDir = writeConfig({
      "opsdash.yaml": `version: 1
plugins:
  reference: { version: "^1.0.0" }
  throws: { version: "^1.0.0" }
  slow: { version: "^1.0.0" }
  bad-api: { version: "^1.0.0" }
  missing: { version: "^1.0.0" }
  reference-old: { version: "^9.0.0" }
dashboards:
  - id: main
    title: Main
    items:
${widget("ok", "reference", 1)}
${widget("boom", "throws", 4)}
${widget("sleepy", "slow", 7)}
${widget("refused", "bad-api", 10)}
${widget("absent", "missing", 1, 3)}
`,
    });
    h = await start({ configDir, pluginsDir });
    const status = await (await fetch(`${h.ops.url}/api/status`)).json();
    const byId = Object.fromEntries(status.plugins.map((p: { id: string }) => [p.id, p]));

    expect(byId["bad-api"]).toMatchObject({ state: "refused", refusal: expect.stringContaining("plugin API ^2.0.0") });
    expect(byId["no-manifest-fields"]).toMatchObject({ state: "refused", refusal: expect.stringContaining("server") });
    expect(byId.dup).toMatchObject({ state: "refused", refusal: expect.stringContaining("Duplicate plugin id") });
    expect(status.plugins.filter((p: { id: string }) => p.id === "dup")).toHaveLength(2);
    expect(byId.mutating).toMatchObject({
      state: "refused",
      refusal: expect.stringContaining("mutating capabilities"),
    });
    expect(byId["no-mock"]).toMatchObject({ state: "refused", refusal: expect.stringContaining("mock source") });
    expect(byId["import-crash"]).toMatchObject({
      state: "refused",
      refusal: expect.stringContaining("Top-level crash"),
    });
    expect(byId.throws.state).toBe("loaded");

    const d = await (await fetch(`${h.ops.url}/api/dashboards/main`)).json();
    const items = Object.fromEntries(d.items.map((i: { path: string }) => [i.path, i]));
    expect(items["main/refused"]).toMatchObject({ status: "plugin-refused", placeholder: { pluginId: "bad-api" } });
    expect(items["main/absent"]).toMatchObject({
      status: "plugin-missing",
      placeholder: { pluginId: "missing", requiredVersion: "^1.0.0" },
    });

    const client = await sse(h.ops.url, "main");
    await h.ops.scheduler.idle();
    const data = (path: string) => h!.ops.scheduler.latest(path);
    expect(data("main/ok")?.state).toBe("ok");
    expect(data("main/boom")).toMatchObject({ state: "error", error: "Source exploded" });
    expect(data("main/sleepy")?.state).toBe("timeout");

    // The healthy plugin keeps updating on schedule even while the others fail (SC-005).
    const before = data("main/ok")!.fetchedAt!;
    await new Promise((r) => setTimeout(r, 5));
    const slowRun = h.ops.scheduler.tick("slow"); // hangs until its 1s timeout
    const t0 = Date.now();
    await h.ops.scheduler.tick("reference");
    expect(Date.now() - t0).toBeLessThan(500);
    expect(data("main/ok")!.fetchedAt!).toBeGreaterThan(before);
    await slowRun;
    client.close();

    const health = await (await fetch(`${h.ops.url}/healthz`)).json();
    expect(health.status).toBe("degraded");
  });

  it("shows a placeholder when the installed version is outside the configured range", async () => {
    const configDir = writeConfig({
      "opsdash.yaml": refConfig(`  - id: d
    title: D
    items:
      - { id: w, plugin: reference, at: [1, 1], size: [3, 2] }`).replace('"^1.0.0"', '"^9.0.0"'),
    });
    h = await start({ configDir });
    const d = await (await fetch(`${h.ops.url}/api/dashboards/d`)).json();
    expect(d.items[0]).toMatchObject({
      status: "plugin-incompatible",
      placeholder: { pluginId: "reference", requiredVersion: "^9.0.0", reason: expect.stringContaining("1.0.0") },
    });
  });
});

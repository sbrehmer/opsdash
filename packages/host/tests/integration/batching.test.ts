import { MOCK_REQUESTS_KEY } from "@opsdash/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { copyExamples, type Harness, refConfig, sse, start, writeConfig } from "../helpers.ts";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const requests = () => (h!.ops.repos.stateGet("reference", MOCK_REQUESTS_KEY) as number | undefined) ?? 0;
const cycles = () => h!.logs.events("refresh.cycle");

describe("batched, de-duplicated refresh cycles (US5)", () => {
  it("20 widgets and 25 unique refs make one request per cycle, regardless of viewers", async () => {
    h = await start({ configDir: copyExamples() });
    const a = await sse(h.ops.url, "batching-demo");
    await h.ops.scheduler.idle();
    expect(requests()).toBe(1);
    expect(cycles().at(-1)).toMatchObject({ requests: 1, refs: 25, widgets: 20 });

    // US5-7: more viewers of a covered dashboard add no requests.
    const b = await sse(h.ops.url, "batching-demo");
    const c = await sse(h.ops.url, "batching-demo");
    await h.ops.scheduler.idle();
    expect(requests()).toBe(1);

    // A scheduled cycle after the cache window: still one request with 3 viewers (SC-004).
    h.ops.scheduler.cache.clear();
    await h.ops.scheduler.tick("reference");
    expect(requests()).toBe(2);
    expect(cycles().at(-1)).toMatchObject({ requests: 1, refs: 25 });
    for (const s of [a, b, c]) s.close();
  });

  it("makes no requests without viewers and serves refs inside the cache window from cache", async () => {
    h = await start({ configDir: copyExamples() });
    await h.ops.scheduler.tick("reference");
    expect(requests()).toBe(0);

    const s = await sse(h.ops.url, "overview");
    await h.ops.scheduler.idle();
    expect(requests()).toBe(1);
    await h.ops.scheduler.tick("reference");
    expect(requests()).toBe(1); // everything still cached (30s window)
    expect(cycles().at(-1)).toMatchObject({ requests: 0 });
    s.close();
  });

  it("chunks to maxBatchSize, never overlaps, and isolates per-ref errors and odd results", async () => {
    const items = Array.from({ length: 25 }, (_, i) => `"ITEM-${i + 1}"`).join(", ");
    const configDir = writeConfig({
      "opsdash.yaml": refConfig(
        `  - id: d
    title: D
    items:
      - { id: w, plugin: reference, at: [1, 1], size: [6, 4], settings: { items: [${items}] } }`,
        `    cacheWindow: 0s
    mock: { errorKeys: ["ITEM-2"], omitKeys: ["ITEM-3"], extraKeys: ["ZZZ-1"], latencyMs: 300 }`,
      ),
    });
    h = await start({ configDir });
    // maxBatchSize comes from the manifest (100); override via the registry record for this test.
    h.ops.registry.get("reference")!.manifest!.maxBatchSize = 10;
    const s = await sse(h.ops.url, "d");
    await h.ops.scheduler.idle();
    expect(requests()).toBe(3);

    const data = h.ops.scheduler.latest("d/w")!;
    expect(data.state).toBe("ok");
    const byKey = Object.fromEntries(data.items.map((i) => [i.refKey, i]));
    expect(byKey["ITEM-1"]!.data).toBeDefined();
    expect(byKey["ITEM-2"]!.error).toBe("Simulated error for ITEM-2");
    expect(byKey["ITEM-3"]!.error).toBe("No result returned for ITEM-3");
    expect(byKey["ZZZ-1"]).toBeUndefined();

    // A tick while a run is in flight is skipped rather than overlapping (FR-026).
    const first = h.ops.scheduler.tick("reference");
    await h.ops.scheduler.tick("reference");
    await first;
    expect(requests()).toBe(6);
    expect(h.logs.events("refresh.skipped")).toHaveLength(1);
    s.close();
  });

  it("keeps showing the last good data as stale when a later fetch fails", async () => {
    const configDir = writeConfig({
      "opsdash.yaml": refConfig(
        `  - id: d
    title: D
    items:
      - { id: w, plugin: reference, at: [1, 1], size: [6, 4], settings: { items: ["ITEM-1"] } }`,
        "    cacheWindow: 0s",
      ),
    });
    h = await start({ configDir });
    const s = await sse(h.ops.url, "d");
    await h.ops.scheduler.idle();
    const good = h.ops.scheduler.latest("d/w")!;
    h.ops.resolved().plugins.get("reference")!.mockFaults = { errorRate: 1 };
    await h.ops.scheduler.tick("reference");
    const stale = h.ops.scheduler.latest("d/w")!;
    expect(stale).toMatchObject({ state: "stale", lastSuccessAt: good.fetchedAt, error: "Simulated source failure" });
    expect(stale.items).toEqual(good.items);
    await s.waitFor((e) => e.event === "widget-data" && e.data.state === "stale");
    s.close();
  });
});

describe("config reloads", () => {
  it("refetches visible widgets of a plugin whose config changed", async () => {
    const { copyExamples: copy } = await import("../helpers.ts");
    const { readFileSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = copy();
    h = await start({ configDir: dir });
    const s = await sse(h.ops.url, "details");
    await h.ops.scheduler.idle();
    const before = requests();
    const file = join(dir, "opsdash.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace('notFound: ["ITEM-404"]', 'notFound: ["ITEM-405"]'));
    h.ops.reloadConfig();
    await h.ops.scheduler.idle();
    expect(requests()).toBe(before + 1);
    s.close();
  });
});

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyReference } from "../../fixtures/plugins/variants.ts";
import { copyExamples, type Harness, sse, start, tmp } from "../helpers.ts";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

describe("hot reload (FR-011, dev plugin reload)", () => {
  it("reloads a rebuilt plugin and tells viewers to re-import its widget", async () => {
    const pluginsDir = tmp("opsdash-plugins-");
    copyReference(pluginsDir);
    h = await start({ configDir: copyExamples(), pluginsDir, watch: true });
    const events = await sse(h.ops.url, "overview");
    const manifest = join(pluginsDir, "reference/dist/opsdash.manifest.json");
    await new Promise((r) => setTimeout(r, 300)); // let the watcher settle
    writeFileSync(manifest, readFileSync(manifest, "utf8").replace('"version": "1.0.0"', '"version": "1.0.1"'));
    const e = await events.waitFor((x) => x.event === "plugin-reloaded", 5000);
    expect(e.data).toMatchObject({
      id: "reference",
      clientUrl: expect.stringMatching(/^\/plugins\/reference\/client\.js\?v=\d+$/),
    });
    expect(h.ops.registry.get("reference")!.version).toBe("1.0.1");
    events.close();
  });

  it("applies config edits without a restart", async () => {
    const dir = copyExamples();
    h = await start({ configDir: dir, watch: true });
    const events = await sse(h.ops.url, "overview");
    await new Promise((r) => setTimeout(r, 300));
    const file = join(dir, "opsdash.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("title: Open items", "title: Open work"));
    await events.waitFor((x) => x.event === "dashboard-changed" && x.data.id === "overview", 5000);
    const d = await (await fetch(`${h.ops.url}/api/dashboards/overview`)).json();
    expect(d.items[0].title).toBe("Open work");
    events.close();
  });
});

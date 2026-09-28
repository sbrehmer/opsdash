import { describe, expect, it } from "vitest";
import { expand, substitute } from "../../src/config/blocks.ts";
import { loadConfig } from "../../src/config/load.ts";
import { EXAMPLES, writeConfig } from "../helpers.ts";

describe("blocks and includes (US4)", () => {
  it("expands blocks with parameters into per-use widget paths", () => {
    const set = loadConfig(EXAMPLES);
    expect(set.errors).toEqual([]);
    expect(set.files.sort()).toEqual([
      "blocks.yaml",
      "dashboards/batching.yaml",
      "dashboards/delivery.yaml",
      "dashboards/team.yaml",
      "opsdash.yaml",
    ]);
    const overview = set.dashboards.find((d) => d.id === "overview")!;
    const tree = expand(set, overview.items, "overview");
    const block = tree.find((e) => e.kind === "block")!;
    expect(block).toMatchObject({ kind: "block", id: "team-a", use: "team-panel", at: [7, 5], size: [6, 3] });
    const inner = block.kind === "block" ? block.items[0]! : undefined;
    expect(inner).toMatchObject({
      kind: "widget",
      path: "overview/team-a/items",
      placement: { title: "Team A items" },
    });
  });

  it("nests blocks and substitutes defaults", () => {
    const dir = writeConfig({
      "opsdash.yaml": `version: 1
include: [blocks.yaml]
plugins: { reference: { version: "^1.0.0" } }
dashboards:
  - id: d
    title: D
    items:
      - { id: outer, use: outer, at: [1, 1], size: [12, 4] }
`,
      "blocks.yaml": `blocks:
  outer:
    items:
      - { id: inner, use: inner, at: [1, 1], size: [12, 2], with: { name: "Nested" } }
  inner:
    params: { name: { default: "Default" }, suffix: { default: "!" } }
    items:
      - { id: w, plugin: reference, title: "\${name}\${suffix}", at: [1, 1], size: [12, 2] }
`,
    });
    const set = loadConfig(dir);
    expect(set.errors).toEqual([]);
    const tree = expand(set, set.dashboards[0]!.items, "d");
    const outer = tree[0]!;
    const inner = outer.kind === "block" ? outer.items[0]! : undefined;
    const widget = inner?.kind === "block" ? inner.items[0] : undefined;
    expect(widget).toMatchObject({
      path: "d/outer/inner/w",
      placement: { title: "Nested!" },
      blocks: ["outer", "inner"],
    });
  });

  it("substitutes inside nested settings and leaves unknown placeholders", () => {
    expect(substitute({ a: "${x}-${y}", b: ["${x}"] }, { x: "1" })).toEqual({ a: "1-${y}", b: ["1"] });
  });
});

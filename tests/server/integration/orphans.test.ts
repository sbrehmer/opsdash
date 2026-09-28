import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyExamples, type Harness, start } from "../helpers.ts";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const edit = (dir: string, file: string, fn: (s: string) => string) =>
  writeFileSync(join(dir, file), fn(readFileSync(join(dir, file), "utf8")));

describe("deleting tracked items of removed widgets (FR-032, data-model §C)", () => {
  it("deletes refs of a widget removed from a valid config and logs it", async () => {
    const dir = copyExamples();
    h = await start({ configDir: dir });
    h.ops.repos.trackRef("overview/watchlist", "reference", "ITEM-1", { key: "ITEM-1" });
    h.ops.repos.trackRef("overview/watchlist", "reference", "ITEM-2", { key: "ITEM-2" });
    edit(dir, "opsdash.yaml", (s) => s.replace("- id: watchlist", "- id: watchlist-renamed"));
    h.ops.reloadConfig();
    expect(h.ops.repos.listRefs("overview/watchlist")).toHaveLength(0);
    expect(h.logs.events("refs.deleted")).toEqual([
      expect.objectContaining({ widgetPath: "overview/watchlist", count: 2 }),
    ]);
  });

  it("deletes nothing when any file has a YAML syntax error", async () => {
    const dir = copyExamples();
    h = await start({ configDir: dir });
    h.ops.repos.trackRef("overview/watchlist", "reference", "ITEM-1", { key: "ITEM-1" });
    edit(dir, "opsdash.yaml", (s) => s.replace("- id: watchlist", "- id: watchlist-renamed"));
    edit(dir, "blocks.yaml", (s) => `${s}\n  broken: [unclosed\n`);
    h.ops.reloadConfig();
    expect(h.ops.repos.listRefs("overview/watchlist")).toHaveLength(1);
  });

  it("deletes nothing for a dashboard that has validation errors", async () => {
    const dir = copyExamples();
    h = await start({ configDir: dir });
    h.ops.repos.trackRef("overview/watchlist", "reference", "ITEM-1", { key: "ITEM-1" });
    edit(dir, "opsdash.yaml", (s) =>
      s.replace("- id: watchlist", "- id: watchlist-renamed").replace("size: [6, 3]", "size: [60, 3]"),
    );
    h.ops.reloadConfig();
    expect(h.ops.resolved().invalidDashboards.has("overview")).toBe(true);
    expect(h.ops.repos.listRefs("overview/watchlist")).toHaveLength(1);
  });

  it("deletes the old path's refs when a block use is renamed", async () => {
    const dir = copyExamples();
    h = await start({ configDir: dir });
    h.ops.repos.trackRef("team/team-b/items", "reference", "ITEM-1", { key: "ITEM-1" });
    edit(dir, "dashboards/team.yaml", (s) => s.replace("id: team-b", "id: team-x"));
    h.ops.reloadConfig();
    expect(h.ops.repos.listRefs("team/team-b/items")).toHaveLength(0);
  });

  it("also applies the rule at startup", async () => {
    const dir = copyExamples();
    h = await start({ configDir: dir });
    h.ops.repos.trackRef("gone/widget", "reference", "ITEM-1", { key: "ITEM-1" });
    const db = h.ops.store.file;
    await h.close();
    h = await start({ configDir: dir, dbFile: db });
    expect(h.ops.repos.listRefs("gone/widget")).toHaveLength(0);
  });
});

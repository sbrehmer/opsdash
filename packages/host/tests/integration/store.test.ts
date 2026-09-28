import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openStore, StoreError } from "../../src/store/db.ts";
import { createRepos } from "../../src/store/repos.ts";
import { tmp } from "../helpers.ts";

describe("store and migrations", () => {
  it("migrates a fresh store and is idempotent on restart", () => {
    const file = join(tmp(), "s.db");
    const a = openStore(file);
    createRepos(a.db).trackRef("d/w", "reference", "ITEM-1", { key: "ITEM-1" });
    a.close();
    const b = openStore(file);
    expect(createRepos(b.db).listRefs("d/w")).toHaveLength(1);
    b.close();
  });

  it("keeps data across 100 restarts (SC-008)", () => {
    const file = join(tmp(), "s.db");
    for (let i = 0; i < 100; i++) {
      const s = openStore(file);
      const repos = createRepos(s.db);
      if (i === 0) {
        const x = repos.trackRef("d/w", "reference", "ITEM-1", { key: "ITEM-1" });
        const y = repos.trackRef("d/v", "other", "PR-1", { n: 1 });
        repos.createLink(x.id, y.id, "reference");
        repos.stateSet("reference", "k", { v: 1 });
      }
      s.close();
    }
    const s = openStore(file);
    const repos = createRepos(s.db);
    const [ref] = repos.listRefs("d/w");
    expect(ref?.ref).toEqual({ key: "ITEM-1" });
    expect(repos.listLinks(ref!.id)).toHaveLength(1);
    expect(repos.stateGet("reference", "k")).toEqual({ v: 1 });
    s.close();
  });

  it("refuses a store written by a newer version without modifying it (FR-031)", () => {
    const file = join(tmp(), "s.db");
    const s = openStore(file);
    s.sqlite.prepare("insert into __drizzle_migrations (hash, created_at) values ('future-hash', 1)").run();
    s.sqlite.pragma("wal_checkpoint(TRUNCATE)");
    s.close();
    const before = readFileSync(file);
    expect(() => openStore(file)).toThrow(StoreError);
    expect(() => openStore(file)).toThrow(/newer, incompatible version/);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("refuses a corrupt store without modifying it", () => {
    const file = join(tmp(), "s.db");
    writeFileSync(file, "this is not a database, just some text that is long enough to have a header".repeat(20));
    const before = readFileSync(file);
    expect(() => openStore(file)).toThrow(/unreadable or corrupt/);
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  it("cascades links when either reference is removed", () => {
    const s = openStore(join(tmp(), "s.db"));
    const repos = createRepos(s.db);
    const x = repos.trackRef("d/w", "reference", "ITEM-1", {});
    const y = repos.trackRef("d/v", "reference", "ITEM-2", {});
    repos.createLink(x.id, y.id, "reference");
    expect(repos.listLinks(y.id)).toEqual([{ fromRefId: x.id, toRefId: y.id, createdBy: "reference" }]);
    repos.untrackRef("d/w", "ITEM-1");
    expect(repos.listLinks(y.id)).toEqual([]);
    s.close();
  });
});

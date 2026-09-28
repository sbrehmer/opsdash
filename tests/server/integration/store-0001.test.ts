import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, openStore } from "../../../src/server/store/db.ts";
import { migrationFiles } from "../../../src/server/store/drizzle.ts";
import { createRepos, DuplicateRefError } from "../../../src/server/store/repos.ts";
import { tmp } from "../helpers.ts";

/** Builds a store file exactly as the 001 host left it: only migration 0000 applied and recorded. */
function storeAt0000(file: string): void {
  const migrations = migrationFiles.readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
  const init = migrations[0]!;
  expect(migrations.length).toBeGreaterThanOrEqual(2);
  const sqlite = new Database(file);
  for (const stmt of init.sql) if (stmt.trim()) sqlite.exec(stmt);
  // Same table and row that drizzle-orm's SQLite migrator writes.
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );
  sqlite
    .prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
    .run(init.hash, init.folderMillis);
  sqlite
    .prepare("INSERT INTO tracked_ref (widget_path, plugin_id, ref_key, ref, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("d/w", "reference", "ITEM-1", JSON.stringify({ key: "ITEM-1" }), 1);
  sqlite.close();
}

const indexes = (sqlite: Database.Database) =>
  (
    sqlite.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'tracked_ref'").all() as Array<{
      name: string;
    }>
  ).map((r) => r.name);

describe("migration 0001: per-plugin tracked refs (T005)", () => {
  it("keeps existing rows and enforces unique(widget_path, plugin_id, ref_key)", () => {
    const file = join(tmp(), "old.db");
    storeAt0000(file);
    const before = new Database(file, { readonly: true });
    expect(indexes(before)).toContain("tracked_ref_widget_key");
    before.close();

    const store = openStore(file);
    const repos = createRepos(store.db);
    try {
      expect(repos.listRefs("d/w")).toEqual([
        { id: 1, pluginId: "reference", widgetPath: "d/w", refKey: "ITEM-1", ref: { key: "ITEM-1" } },
      ]);
      const applied = store.sqlite.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number };
      expect(applied.n).toBe(migrationFiles.readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR }).length);

      // Same widget and ref key under another plugin is allowed now.
      expect(repos.trackRef("d/w", "other", "ITEM-1", { k: "ITEM-1" }).pluginId).toBe("other");
      // The same triple is rejected.
      expect(() => repos.trackRef("d/w", "reference", "ITEM-1", { key: "ITEM-1" })).toThrow(DuplicateRefError);
      expect(() =>
        store.sqlite
          .prepare("INSERT INTO tracked_ref (widget_path, plugin_id, ref_key, ref, created_at) VALUES (?, ?, ?, ?, ?)")
          .run("d/w", "other", "ITEM-1", "{}", 2),
      ).toThrow(/UNIQUE constraint failed/);

      const names = indexes(store.sqlite);
      expect(names).not.toContain("tracked_ref_widget_key");
      expect(names).toContain("tracked_ref_widget_plugin_key");
    } finally {
      store.close();
    }

    // Reopening is a no-op and the data is still there.
    const again = openStore(file);
    expect(createRepos(again.db).listRefs("d/w")).toHaveLength(2);
    again.close();
  });
});

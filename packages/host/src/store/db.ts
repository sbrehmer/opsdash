import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Logger } from "../log.ts";
import { betterSqlite3, migrationFiles, migrator } from "./drizzle.ts";
import * as schema from "./schema.ts";

export const MIGRATIONS_DIR = join(import.meta.dirname, "../../drizzle");

export type Db = BetterSQLite3Database<typeof schema>;

export class StoreError extends Error {
  override name = "StoreError";
}

export interface Store {
  db: Db;
  sqlite: Database.Database;
  file: string;
  close(): void;
  healthy(): boolean;
}

function appliedHashes(sqlite: Database.Database): string[] {
  const table = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get();
  if (!table) return [];
  return (sqlite.prepare("select hash from __drizzle_migrations").all() as Array<{ hash: string }>).map((r) => r.hash);
}

/**
 * Opens the SQLite store (FR-030, FR-031): checks integrity and refuses a store written by a newer,
 * incompatible version without touching the file, then applies pending migrations.
 */
export function openStore(file: string, log?: Logger): Store {
  const bundled = migrationFiles.readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR });
  const known = new Set(bundled.map((m) => m.hash));
  let before = 0;

  if (existsSync(file)) {
    let check: Database.Database | undefined;
    try {
      check = new Database(file, { readonly: true, fileMustExist: true });
      const result = check.pragma("integrity_check", { simple: true });
      if (result !== "ok") throw new StoreError(`Store ${file} failed its integrity check: ${String(result)}`);
      const applied = appliedHashes(check);
      const unknown = applied.filter((h) => !known.has(h));
      if (unknown.length > 0) {
        throw new StoreError(
          `Store ${file} was written by a newer, incompatible version of Opsdash (${unknown.length} unknown migration(s)). Refusing to start; the file was not modified.`,
        );
      }
      before = applied.length;
    } catch (err) {
      if (err instanceof StoreError) throw err;
      throw new StoreError(
        `Store ${file} is unreadable or corrupt (${(err as Error).message}). Refusing to start; the file was not modified.`,
      );
    } finally {
      check?.close();
    }
  } else {
    mkdirSync(dirname(file), { recursive: true });
  }

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = betterSqlite3.drizzle(sqlite, { schema });
  migrator.migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  if (bundled.length !== before) {
    log?.info({ event: "store.migrated", from: before, to: bundled.length, file }, "Store migrated");
  }

  return {
    db,
    sqlite,
    file,
    close: () => sqlite.close(),
    healthy: () => {
      try {
        sqlite.prepare("select 1").get();
        return true;
      } catch {
        return false;
      }
    },
  };
}

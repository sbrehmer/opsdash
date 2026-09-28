import { createRequire } from "node:module";

/**
 * Loads drizzle-orm's CommonJS build. On Node 24 its ESM build costs ~200 MB extra RSS and ~0.5 s to
 * load (measured 2026-09-27: `import("drizzle-orm/sqlite-core")` 262 MB vs `require` 66 MB), which
 * alone would break the idle-memory budget (research R14). The API and types are identical.
 * drizzle-kit loads the schema as CommonJS, where `require` already exists.
 */
const load = typeof require === "function" ? require : createRequire(import.meta.url);

export const orm = load("drizzle-orm") as typeof import("drizzle-orm");
export const sqliteCore = load("drizzle-orm/sqlite-core") as typeof import("drizzle-orm/sqlite-core");
export const betterSqlite3 = load("drizzle-orm/better-sqlite3") as typeof import("drizzle-orm/better-sqlite3");
export const migrator = load(
  "drizzle-orm/better-sqlite3/migrator",
) as typeof import("drizzle-orm/better-sqlite3/migrator");
export const migrationFiles = load("drizzle-orm/migrator") as typeof import("drizzle-orm/migrator");

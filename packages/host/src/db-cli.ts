#!/usr/bin/env node
/**
 * Database setup for operators: creates the SQLite store and applies pending migrations (the same code path
 * the server runs at startup), reports status, or resets a store file.
 *
 *   node packages/host/src/db-cli.ts setup  --db .data/production.db
 *   node packages/host/src/db-cli.ts status --db .data/production.db
 *   node packages/host/src/db-cli.ts reset  --db .data/mock.db [--force]
 */
import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MIGRATIONS_DIR, openStore, StoreError } from "./store/db.ts";
import { migrationFiles } from "./store/drizzle.ts";

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
const [command = "status", ...rest] = argv;
const { values } = parseArgs({
  args: rest,
  options: { db: { type: "string" }, force: { type: "boolean", default: false } },
});

if (!values.db || !["setup", "status", "reset"].includes(command)) {
  console.error("Usage: db-cli.ts <setup|status|reset> --db <file> [--force]");
  process.exit(2);
}

const file = resolve(values.db);
const bundled = migrationFiles.readMigrationFiles({ migrationsFolder: MIGRATIONS_DIR }).length;

function describe(): void {
  const store = openStore(file);
  const applied = (store.sqlite.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number }).n;
  const refs = (store.sqlite.prepare("select count(*) as n from tracked_ref").get() as { n: number }).n;
  const links = (store.sqlite.prepare("select count(*) as n from ref_link").get() as { n: number }).n;
  store.close();
  const kb = (statSync(file).size / 1024).toFixed(0);
  console.log(`${file}: schema ${applied}/${bundled} migrations, ${refs} tracked item(s), ${links} link(s), ${kb} KB`);
}

try {
  if (command === "reset") {
    if (!existsSync(file)) {
      console.log(`${file}: nothing to reset`);
    } else if (!values.force && /prod/i.test(file)) {
      console.error(`Refusing to reset ${file} without --force (it looks like a production store).`);
      process.exit(1);
    } else {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });
      console.log(`${file}: removed`);
    }
    process.exit(0);
  }
  if (command === "status" && !existsSync(file)) {
    console.log(`${file}: does not exist yet (run setup, or start the server)`);
    process.exit(0);
  }
  const existed = existsSync(file);
  describe(); // opening the store creates it and applies pending migrations
  if (command === "setup") console.log(existed ? "Store is up to date." : "Store created.");
} catch (err) {
  console.error(err instanceof StoreError ? err.message : (err as Error).stack);
  process.exit(1);
}

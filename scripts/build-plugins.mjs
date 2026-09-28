#!/usr/bin/env node
// Builds every plugin under plugins/ with the SDK Vite preset (research R8). A plugin directory has a
// plugin.json (built-in) or a package.json (third-party shape); one with its own vite.config.* uses it.
// Usage: node scripts/build-plugins.mjs [--watch]
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { opsdashPlugin } from "@opsdash/plugin-sdk/vite";
import { build } from "vite";

const ROOT = resolve(import.meta.dirname, "..");
const PLUGINS = join(ROOT, "plugins");
const WATCH = process.argv.includes("--watch");
/** Sources outside a plugin's folder that it builds from; rebuilt on change in watch mode. */
const SHARED_SOURCES = [join(ROOT, "plugin-lib"), join(ROOT, "sdk/src")];

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((f) => join(dir, f))
    .filter((f) => statSync(f).isFile());
}

const watchShared = {
  name: "opsdash-watch-shared",
  buildStart() {
    for (const dir of SHARED_SOURCES) for (const file of listFiles(dir)) this.addWatchFile(file);
  },
};

function pluginDirs() {
  return readdirSync(PLUGINS)
    .map((name) => join(PLUGINS, name))
    .filter((dir) => statSync(dir).isDirectory())
    .filter((dir) => existsSync(join(dir, "plugin.json")) || existsSync(join(dir, "package.json")));
}

function ownConfig(dir) {
  return ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"]
    .map((f) => join(dir, f))
    .find((f) => existsSync(f));
}

async function buildPlugin(dir) {
  const configFile = ownConfig(dir);
  const extra = WATCH ? { plugins: [watchShared], build: { watch: {} } } : {};
  const config = configFile
    ? { root: dir, configFile, logLevel: "warn", ...extra }
    : {
        root: dir,
        configFile: false,
        logLevel: "warn",
        ...extra,
        plugins: [opsdashPlugin(), ...(extra.plugins ?? [])],
      };
  await build(config);
}

const dirs = pluginDirs();
const stale = dirs.filter((dir) => existsSync(join(dir, "node_modules")));
if (existsSync(join(ROOT, "packages")) || stale.length > 0) {
  console.warn(`Found files from the old layout (packages/, plugins/*/node_modules).
Remove them and reinstall: rm -rf packages plugins/*/node_modules node_modules && pnpm install. See MIGRATION.md.`);
}
const results = await Promise.allSettled(dirs.map((dir) => buildPlugin(dir)));
let failed = 0;
results.forEach((r, i) => {
  if (r.status === "rejected") {
    failed++;
    const id = dirs[i].slice(PLUGINS.length + 1);
    console.error(`[${id}] build failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
});
if (failed > 0) process.exit(1);
if (!WATCH) console.log(`Built ${dirs.length} plugin(s).`);

// Brings a checkout up to date before Opsdash starts: the pinned tools (mise install), the dependencies
// (pnpm install) and the build (pnpm build). Each step runs only when its inputs changed, tracked by a
// content hash, so an up-to-date checkout starts without delay. Used by scripts/opsdash.mjs and dev.mjs.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const WINDOWS = process.platform === "win32";
const INSTALL_STAMP = join(ROOT, "node_modules/.opsdash-install");
const BUILD_STAMP = join(ROOT, "dist/.opsdash-build");

/** Inputs of `pnpm install`. */
const INSTALL_INPUTS = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "sdk/package.json", "mise.toml"];
/** Inputs of `pnpm build`, besides every plugin's src/ and plugin.json. */
const BUILD_INPUTS = [
  "src/client",
  "src/shared",
  "sdk/src",
  "plugin-lib",
  "vite.config.ts",
  "scripts/build-plugins.mjs",
  "package.json",
  "pnpm-lock.yaml",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function files(path) {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [path];
  return readdirSync(abs, { recursive: true, encoding: "utf8" })
    .map((f) => join(path, f))
    .filter((f) => statSync(join(ROOT, f)).isFile())
    .sort();
}

function hash(paths) {
  const h = createHash("sha256");
  for (const file of paths.flatMap(files))
    h.update(`${file}\0`)
      .update(readFileSync(join(ROOT, file)))
      .update("\0");
  return h.digest("hex");
}

const readStamp = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");
function writeStamp(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}

function exec(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: WINDOWS });
  return r.error ? undefined : r.status;
}

const onPath = (cmd) => !spawnSync(cmd, ["--version"], { stdio: "ignore", shell: WINDOWS }).error;

let useMise;
/**
 * Installs the pinned tools when mise is available; pnpm then runs through `mise exec`, so a pnpm from
 * elsewhere on PATH (a global install, corepack) cannot shadow the pinned one.
 */
function tools() {
  if (useMise !== undefined) return;
  useMise = onPath("mise") && exec("mise", ["install", "--quiet"]) === 0;
  if (!useMise && !onPath("pnpm")) {
    fail(
      "pnpm not found. Install mise (https://mise.jdx.dev) and run `mise install`, or install the pnpm in mise.toml.",
    );
  }
}

function pnpm(args) {
  tools();
  const status = useMise ? exec("mise", ["exec", "--", "pnpm", ...args]) : exec("pnpm", args);
  if (status !== 0) fail(`\`pnpm ${args.join(" ")}\` failed.`);
}

/** Warns about leftovers of the pre-003 layout (per-package installs), which can shadow the root install. */
function warnStaleLayout() {
  const stale = existsSync(join(ROOT, "packages")) ? ["packages/"] : [];
  if (pluginDirs().some((dir) => existsSync(join(dir, "node_modules")))) stale.push("plugins/*/node_modules");
  if (stale.length === 0) return;
  console.warn(`Found files from the old layout (${stale.join(", ")}).
Remove them and reinstall: rm -rf packages plugins/*/node_modules node_modules && pnpm install. See MIGRATION.md.`);
}

function pluginDirs() {
  const dir = join(ROOT, "plugins");
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((d) => statSync(d).isDirectory())
    .filter((d) => existsSync(join(d, "plugin.json")) || existsSync(join(d, "package.json")));
}

function built() {
  return (
    existsSync(join(ROOT, "dist/web/index.html")) &&
    pluginDirs().every((d) => existsSync(join(d, "dist/opsdash.manifest.json")))
  );
}

/** Steps already checked in this process (a command may call `prepare` more than once). */
const done = { install: false, build: false };

/**
 * Installs dependencies and builds, as needed. `build: false` stops after the install (dev mode and
 * database commands, which don't need the build).
 */
export function prepare({ build = true } = {}) {
  if (!done.install) {
    warnStaleLayout();
    const installHash = hash(INSTALL_INPUTS);
    if (!existsSync(join(ROOT, "node_modules")) || readStamp(INSTALL_STAMP) !== installHash) {
      console.log("Installing dependencies…");
      pnpm(["install", "--frozen-lockfile"]);
      writeStamp(INSTALL_STAMP, installHash);
    }
    done.install = true;
  }
  if (!build || done.build) return;
  done.build = true;
  const pluginInputs = pluginDirs().flatMap((d) => ["src", "plugin.json"].map((f) => relative(ROOT, join(d, f))));
  const buildHash = hash([...BUILD_INPUTS, ...pluginInputs]);
  if (!built() || readStamp(BUILD_STAMP) !== buildHash) {
    console.log("Building the web UI and plugins…");
    pnpm(["build"]);
    writeStamp(BUILD_STAMP, buildHash);
  }
}

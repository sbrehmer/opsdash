#!/usr/bin/env node
// One entry point per environment: resolves the config template, database and secrets for an environment,
// sets up the database, and starts Opsdash. Used by the package scripts (pnpm mock, start:dev, start:prod, db:*).
//
//   node scripts/opsdash.mjs start <env> [--port N] [--no-seed]
//   node scripts/opsdash.mjs db:setup|db:status|db:reset <env> [--force]
//   node scripts/opsdash.mjs config:check <env>
//
// <env> is mock | development | production (or any name with a config/<env>.yaml). Overrides:
// OPSDASH_CONFIG, OPSDASH_DB, OPSDASH_ENV_FILE, OPSDASH_PLUGINS, OPSDASH_PORT (or PORT).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dirname, "..");
const node = process.execPath;
const HOST = join(ROOT, "src/server");

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
const [command, envName, ...rest] = argv;
const { values } = parseArgs({
  args: rest,
  options: {
    port: { type: "string" },
    seed: { type: "boolean", default: true },
    "no-seed": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const usage = () => {
  console.error(`Usage: node scripts/opsdash.mjs <start|db:setup|db:status|db:reset|config:check> <env> [options]
  env: ${listEnvs().join(" | ") || "mock | development | production"}`);
  process.exit(2);
};

function listEnvs() {
  const dir = join(ROOT, "config");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => f.replace(/\.ya?ml$/, ""))
    : [];
}

if (!command || !envName) usage();

const env = {
  name: envName,
  mock: envName === "mock",
  config: resolve(process.env.OPSDASH_CONFIG ?? join(ROOT, "config", `${envName}.yaml`)),
  db: resolve(process.env.OPSDASH_DB ?? join(ROOT, ".data", `${envName}.db`)),
  envFile: resolve(process.env.OPSDASH_ENV_FILE ?? join(ROOT, "config", "env", `${envName}.env`)),
  plugins: resolve(process.env.OPSDASH_PLUGINS ?? join(ROOT, "plugins")),
  port: values.port ?? process.env.OPSDASH_PORT ?? process.env.PORT ?? "4400",
};
const rel = (p) => relative(process.cwd(), p) || ".";

if (!existsSync(env.config)) {
  console.error(`No config for environment "${envName}": ${rel(env.config)} does not exist.`);
  console.error(`Available: ${listEnvs().join(", ")}`);
  process.exit(1);
}

function run(args) {
  return spawnSync(node, args, { stdio: "inherit", cwd: ROOT }).status ?? 1;
}

function dbCommand(cmd) {
  const args = [join(HOST, "db-cli.ts"), cmd, "--db", env.db];
  if (values.force) args.push("--force");
  return run(args);
}

/** Warns about leftovers of the pre-003 layout (per-package installs), which can shadow the root install. */
function warnStaleLayout() {
  const pluginsDir = join(ROOT, "plugins");
  const stale = existsSync(join(ROOT, "packages")) ? ["packages/"] : [];
  if (existsSync(pluginsDir) && readdirSync(pluginsDir).some((p) => existsSync(join(pluginsDir, p, "node_modules")))) {
    stale.push("plugins/*/node_modules");
  }
  if (stale.length === 0) return;
  console.warn(`Found files from the old layout (${stale.join(", ")}).
Remove them and reinstall: rm -rf packages plugins/*/node_modules node_modules && pnpm install. See MIGRATION.md.`);
}

function checkBuilt() {
  warnStaleLayout();
  const missing = [];
  if (!existsSync(join(ROOT, "dist/web/index.html"))) missing.push("web");
  for (const p of readdirSync(env.plugins)) {
    const dir = join(env.plugins, p);
    const isPlugin = existsSync(join(dir, "plugin.json")) || existsSync(join(dir, "package.json"));
    if (isPlugin && !existsSync(join(dir, "dist/opsdash.manifest.json"))) missing.push(rel(dir));
  }
  if (missing.length > 0) {
    console.error(`Not built yet: ${missing.join(", ")}. Run \`pnpm build\` first.`);
    process.exit(1);
  }
}

async function waitHealthy(url, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function start() {
  checkBuilt();
  const fresh = !existsSync(env.db);
  if (dbCommand("setup") !== 0) process.exit(1);

  const args = [
    join(HOST, "main.ts"),
    "--config",
    env.config,
    "--plugins",
    env.plugins,
    "--db",
    env.db,
    "--port",
    env.port,
  ];
  if (existsSync(env.envFile)) args.push("--env-file", env.envFile);
  if (env.mock) args.push("--mock");
  console.log(
    `Starting Opsdash [${env.name}] config=${rel(env.config)} db=${rel(env.db)}` +
      `${existsSync(env.envFile) ? ` env=${rel(env.envFile)}` : ""} port=${env.port}${env.mock ? " (mock)" : ""}`,
  );
  const child = spawn(node, args, { stdio: "inherit", cwd: ROOT });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code) => process.exit(code ?? 0));

  // A fresh mock store gets sample Delivery rows, so the dashboard is not empty on first start.
  if (env.mock && fresh && values.seed && !values["no-seed"]) {
    const url = `http://localhost:${env.port}`;
    if (await waitHealthy(url)) run([join(ROOT, "scripts/seed-delivery.mjs"), "--url", url]);
  }
}

async function configCheck() {
  const { loadConfig } = await import("../src/server/config/load.ts");
  const { resolveConfig } = await import("../src/server/config/resolve.ts");
  const { formatError } = await import("../src/server/config/errors.ts");
  const { PluginRegistry } = await import("../src/server/plugins/registry.ts");
  const { createLogger } = await import("../src/server/log.ts");
  const { Redactor } = await import("../src/server/secrets/redact.ts");
  const { loadEnv } = await import("../src/server/secrets/env.ts");
  const redactor = new Redactor();
  const registry = new PluginRegistry(env.plugins, createLogger(redactor, { write() {} }));
  await registry.loadAll();
  const envVars = loadEnv(existsSync(env.envFile) ? env.envFile : undefined);
  const r = resolveConfig(loadConfig(env.config), registry, { mock: env.mock, env: envVars, redactor });
  let problems = 0;
  for (const e of r.errors) {
    console.error(formatError(e));
    problems++;
  }
  for (const p of registry.all()) {
    if (p.state === "refused") {
      console.error(`plugin ${p.id}: refused — ${p.refusal}`);
      problems++;
    }
  }
  for (const p of r.plugins.values()) {
    for (const issue of p.issues) {
      console.error(`plugin ${p.id}: ${issue}`);
      problems++;
    }
  }
  const dashboards = [...r.dashboards.keys()].join(", ");
  if (problems === 0) console.log(`${rel(env.config)}: OK (${r.set.files.length} file(s); dashboards: ${dashboards})`);
  process.exit(problems === 0 ? 0 : 1);
}

switch (command) {
  case "start":
    await start();
    break;
  case "db:setup":
    process.exit(dbCommand("setup"));
    break;
  case "db:status":
    process.exit(dbCommand("status"));
    break;
  case "db:reset":
    process.exit(dbCommand("reset"));
    break;
  case "config:check":
    await configCheck();
    break;
  default:
    usage();
}

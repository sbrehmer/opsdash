#!/usr/bin/env node
// `pnpm dev`: the server under watch (mock mode), the Vite dev server with HMR on :5173 (proxying the
// server on :4400), and plugin watch builds, in one terminal. Ctrl-C, or any process exiting, stops all.
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { prepare } from "./prepare.mjs";

const ROOT = resolve(import.meta.dirname, "..");
// The watchers build everything themselves; only the tools and dependencies must be in place.
prepare({ build: false });
const node = process.execPath;

const processes = {
  server: [
    node,
    [
      "--watch-path=src/server",
      "--watch-path=src/shared",
      "--watch-path=sdk/src",
      "src/server/main.ts",
      "--config",
      "examples/config",
      "--plugins",
      "plugins",
      "--db",
      ".data/dev.db",
      "--mock",
    ],
  ],
  web: [node, [join(ROOT, "node_modules/vite/bin/vite.js")]],
  plugins: [node, ["scripts/build-plugins.mjs", "--watch"]],
};

const children = [];
let exitCode;

function stopAll(code) {
  if (exitCode !== undefined) return;
  exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
}

function prefixed(stream, out, label) {
  let pending = "";
  stream.on("data", (chunk) => {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop();
    for (const line of lines) out.write(`[${label}] ${line}\n`);
  });
  stream.on("end", () => pending && out.write(`[${label}] ${pending}\n`));
}

for (const [label, [cmd, args]] of Object.entries(processes)) {
  const child = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  prefixed(child.stdout, process.stdout, label);
  prefixed(child.stderr, process.stderr, label);
  child.on("exit", (code, signal) => {
    if (exitCode === undefined) console.error(`[${label}] exited (${signal ?? code}); stopping the others`);
    stopAll(code ?? 1);
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) process.exit(exitCode);
  });
  children.push(child);
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => stopAll(0));

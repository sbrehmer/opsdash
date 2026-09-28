// Budget check (research R14): cold start to healthy ≤ 1.5 s and idle RSS ≤ 150 MB.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const port = 4499;
const db = join(mkdtempSync(join(tmpdir(), "opsdash-cold-")), "cold.db");
const started = performance.now();
const child = spawn(
  process.execPath,
  [
    "src/server/main.ts",
    "--config",
    "examples/config",
    "--plugins",
    "plugins",
    "--db",
    db,
    "--mock",
    "--port",
    String(port),
  ],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
);

let ready = 0;
for (;;) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    if ((await res.json()).status === "healthy") {
      ready = performance.now() - started;
      break;
    }
  } catch {}
  if (performance.now() - started > 10_000) break;
  await new Promise((r) => setTimeout(r, 20));
}
await new Promise((r) => setTimeout(r, 3000));
const rssKb = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/status`, "utf8"))?.[1] ?? 0);
child.kill("SIGTERM");

const rssMb = rssKb / 1024;
console.log(`cold start to healthy: ${ready.toFixed(0)} ms (budget 1500)`);
console.log(`idle RSS: ${rssMb.toFixed(1)} MB (budget 150)`);
if (!ready || ready > 1500 || rssMb > 150) process.exit(1);

// Adds sample rows to the Delivery tracker through the public actions API of a running Opsdash
// (tracked items are data, not config, so they cannot live in the example YAML).
// Usage: node scripts/seed-delivery.mjs [--url http://localhost:4400] [--rows 8] [--repos 2] [--widget delivery/tracker]
import { parseArgs } from "node:util";

const argv = process.argv.slice(2);
if (argv[0] === "--") argv.shift();
const { values } = parseArgs({
  args: argv,
  options: {
    url: { type: "string", default: "http://localhost:4400" },
    rows: { type: "string", default: "8" },
    repos: { type: "string", default: "2" },
    widget: { type: "string", default: "delivery/tracker" },
  },
});

const REPOS = ["web", "api", "mobile", "infra", "docs"].slice(0, Math.max(1, Number(values.repos)));
const endpoint = `${values.url}/api/widgets/${encodeURIComponent(values.widget)}/actions/addRow`;
let added = 0;
let failed = 0;

for (let i = 0; i < Number(values.rows); i++) {
  const repo = REPOS[i % REPOS.length];
  const number = 1400 + i * 7;
  // Mix the ways rows are added: PR only, job only, PR + explicit story.
  const payload =
    i % 3 === 1
      ? { job: `acme/${repo}/PR-${number}` }
      : i % 3 === 2
        ? { pr: `acme/${repo}#${number}`, story: `PROJ-${(number % 97) + 1}` }
        : { pr: `acme/${repo}#${number}` };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) added++;
  else {
    failed++;
    console.warn(`  ${JSON.stringify(payload)} → ${res.status} ${body.error ?? ""}`);
  }
}

console.log(`Seeded ${added} row(s) into ${values.widget}${failed ? `, ${failed} failed` : ""}.`);
if (added === 0) process.exit(1);

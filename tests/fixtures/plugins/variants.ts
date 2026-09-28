import { cpSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REFERENCE_DIST = join(import.meta.dirname, "../../../plugins/reference/dist");

type Variant = { manifest?: (m: Record<string, unknown>) => void; server?: string };

/**
 * Plugin fixture variants (T052), generated from the built reference plugin so they stay in sync:
 * the reference server module becomes `base.js` and `server.js` overrides parts of it.
 */
export const VARIANTS: Record<string, Variant> = {
  "bad-api": { manifest: (m) => (m.apiVersion = "^2.0.0") },
  "no-manifest-fields": { manifest: (m) => delete m.server },
  "dup-a": { manifest: (m) => (m.id = "dup") },
  "dup-b": { manifest: (m) => (m.id = "dup") },
  mutating: { manifest: (m) => (m.capabilities = ["track", "write"]) },
  "no-mock": {
    manifest: (m) => (m.hasMock = true),
    server: `import base from "./base.js"; const { mock, ...rest } = base; export default rest;`,
  },
  throws: {
    server: `import base from "./base.js";
const failing = { ...base.mock, fetch: async () => { throw new Error("Source exploded"); } };
export default { ...base, fetch: failing.fetch, mock: failing };`,
  },
  slow: {
    manifest: (m) => (m.refresh = { interval: "60s", timeout: "1s" }),
    server: `import base from "./base.js";
const slow = { ...base.mock, fetch: (refs, ctx) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve(new Map()), 30000);
  ctx.signal.addEventListener("abort", () => { clearTimeout(t); reject(ctx.signal.reason); });
}) };
export default { ...base, fetch: slow.fetch, mock: slow };`,
  },
  "import-crash": { server: `throw new Error("Top-level crash");` },
};

/** Writes the named variants into `pluginsDir/<name>/dist` with their ids set to the variant name. */
export function writeVariants(pluginsDir: string, names: string[] = Object.keys(VARIANTS)): void {
  for (const name of names) {
    const variant = VARIANTS[name]!;
    const dist = join(pluginsDir, name, "dist");
    mkdirSync(dist, { recursive: true });
    cpSync(REFERENCE_DIST, dist, { recursive: true });
    renameSync(join(dist, "server.js"), join(dist, "base.js"));
    writeFileSync(join(dist, "server.js"), variant.server ?? `export { default } from "./base.js";`);
    const manifest = JSON.parse(readFileSync(join(dist, "opsdash.manifest.json"), "utf8"));
    manifest.id = name;
    variant.manifest?.(manifest);
    writeFileSync(join(dist, "opsdash.manifest.json"), JSON.stringify(manifest, null, 2));
  }
}

/** Copies the built reference plugin as-is (optionally under another id). */
export function copyReference(pluginsDir: string, id = "reference"): void {
  const dist = join(pluginsDir, id, "dist");
  mkdirSync(dist, { recursive: true });
  cpSync(REFERENCE_DIST, dist, { recursive: true });
  if (id !== "reference") {
    const file = join(dist, "opsdash.manifest.json");
    const m = JSON.parse(readFileSync(file, "utf8"));
    m.id = id;
    writeFileSync(file, JSON.stringify(m, null, 2));
  }
}

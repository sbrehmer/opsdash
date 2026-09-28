import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Fresh, editable copy of the example config and an empty store for every E2E run. */
export default function globalSetup() {
  const root = join(import.meta.dirname, "../..");
  for (const need of ["packages/web/dist/index.html", "plugins/reference/dist/opsdash.manifest.json"]) {
    if (!existsSync(join(root, need))) throw new Error(`Missing ${need}; run pnpm build first`);
  }
  const config = join(root, ".data/e2e-config");
  rmSync(config, { recursive: true, force: true });
  for (const f of ["e2e.db", "e2e.db-wal", "e2e.db-shm"]) rmSync(join(root, ".data", f), { force: true });
  cpSync(join(root, "examples/config"), config, { recursive: true });
}

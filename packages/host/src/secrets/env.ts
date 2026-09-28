import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/**
 * Secrets come only from the process environment or an env file (FR-033). Env file values fill only
 * keys missing from the process environment, so the process environment wins. Nothing is written back.
 */
export function loadEnv(envFile?: string, processEnv: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const merged = new Map<string, string>();
  if (envFile) {
    const parsed = parseEnv(readFileSync(envFile, "utf8"));
    for (const [k, v] of Object.entries(parsed)) if (v !== undefined) merged.set(k, v);
  }
  for (const [k, v] of Object.entries(processEnv)) if (v !== undefined) merged.set(k, v);
  return merged;
}

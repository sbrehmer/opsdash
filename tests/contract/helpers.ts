import { join } from "node:path";
import { loadConfig } from "../../src/server/config/load.ts";
import { resolveConfig } from "../../src/server/config/resolve.ts";
import { createLogger } from "../../src/server/log.ts";
import { PluginRegistry } from "../../src/server/plugins/registry.ts";
import { Redactor } from "../../src/server/secrets/redact.ts";

export const ROOT = join(import.meta.dirname, "../..");

export async function registry(dir = join(ROOT, "plugins")) {
  const r = new PluginRegistry(dir, createLogger(new Redactor(), { write() {} } as never));
  await r.loadAll();
  return r;
}

export async function resolveDir(configDir: string, mock = true) {
  return resolveConfig(loadConfig(configDir), await registry(), { mock, env: new Map(), redactor: new Redactor() });
}

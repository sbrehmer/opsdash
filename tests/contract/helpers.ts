import { join } from "node:path";
import { loadConfig } from "../../packages/host/src/config/load.ts";
import { resolveConfig } from "../../packages/host/src/config/resolve.ts";
import { createLogger } from "../../packages/host/src/log.ts";
import { PluginRegistry } from "../../packages/host/src/plugins/registry.ts";
import { Redactor } from "../../packages/host/src/secrets/redact.ts";

export const ROOT = join(import.meta.dirname, "../..");

export async function registry(dir = join(ROOT, "plugins")) {
  const r = new PluginRegistry(dir, createLogger(new Redactor(), { write() {} } as never));
  await r.loadAll();
  return r;
}

export async function resolveDir(configDir: string, mock = true) {
  return resolveConfig(loadConfig(configDir), await registry(), { mock, env: new Map(), redactor: new Redactor() });
}

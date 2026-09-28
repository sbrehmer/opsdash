import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DefinedPlugin, PluginManifest } from "@opsdash/plugin-sdk";
import { parseDuration } from "../config/primitives.ts";
import type { Logger } from "../log.ts";
import { checkManifest, MANIFEST_FILE } from "./manifest.ts";

export interface PluginRecord {
  id: string;
  dir: string;
  version?: string;
  state: "loaded" | "refused";
  refusal?: string;
  manifest?: PluginManifest;
  module?: DefinedPlugin;
  /** Bumped on every (re)load; used to bust browser and module caches. */
  revision: number;
}

const REQUIRED_EXPORTS = ["settings", "reference", "refKey", "parseReference", "fetch"] as const;

async function importServer(dir: string, manifest: PluginManifest): Promise<DefinedPlugin> {
  const file = join(dir, "dist", manifest.server);
  const url = `${pathToFileURL(file).href}?v=${statSync(file).mtimeMs}`;
  const mod = (await import(url)) as { default?: DefinedPlugin };
  const plugin = mod.default;
  if (!plugin || typeof plugin !== "object") throw new Error("Server module has no default export (use definePlugin)");
  if (manifest.composes) {
    if (plugin.settings === undefined) throw new Error("Server module is missing: settings");
    return plugin;
  }
  const missing = REQUIRED_EXPORTS.filter((k) => plugin[k] === undefined);
  if (missing.length > 0) throw new Error(`Server module is missing: ${missing.join(", ")}`);
  if (typeof plugin.mock?.fetch !== "function" || typeof plugin.mock?.parseReference !== "function") {
    throw new Error("Plugin does not export a mock source (required)");
  }
  return plugin;
}

/** Discovers, checks and loads plugins from the plugin directory (FR-014 to FR-016). */
export class PluginRegistry {
  #records = new Map<string, PluginRecord>();
  #refused: PluginRecord[] = [];
  #revision = 0;
  readonly dir: string;
  readonly log: Logger;

  constructor(dir: string, log: Logger) {
    this.dir = resolve(dir);
    this.log = log;
  }

  pluginDirs(): string[] {
    let entries: string[] = [];
    try {
      entries = readdirSync(this.dir);
    } catch {
      this.log.warn({ event: "plugins.missing", dir: this.dir }, "Plugin directory not found");
    }
    return entries.map((e) => join(this.dir, e)).filter((d) => statSync(d).isDirectory());
  }

  async loadAll(): Promise<void> {
    this.#records.clear();
    this.#refused = [];
    const checks = this.pluginDirs().map((dir) => ({ dir, check: checkManifest(dir) }));
    const byId = new Map<string, string[]>();
    for (const { dir, check } of checks) {
      const id = check.ok ? check.manifest.id : check.id;
      if (id) byId.set(id, [...(byId.get(id) ?? []), dir]);
    }
    for (const { dir, check } of checks) {
      const id = check.ok ? check.manifest.id : check.id;
      const dirs = id ? byId.get(id)! : [];
      if (id && dirs.length > 1) {
        this.#refuse(
          { id, dir, version: check.ok ? check.manifest.version : check.version },
          `Duplicate plugin id "${id}" (${dirs.map((d) => d.slice(this.dir.length + 1)).join(", ")})`,
        );
        continue;
      }
      if (!check.ok) {
        this.#refuse({ id: id ?? dir.slice(this.dir.length + 1), dir, version: check.version }, check.reason);
        continue;
      }
      await this.#load(dir, check.manifest);
    }
  }

  /** Re-checks and re-imports one plugin directory (dev hot reload). Returns the plugin id. */
  async reload(dir: string): Promise<string | undefined> {
    const check = checkManifest(dir);
    const id = check.ok ? check.manifest.id : check.id;
    if (!id) return undefined;
    this.#refused = this.#refused.filter((r) => r.dir !== dir);
    this.#records.delete(id);
    if (!check.ok) this.#refuse({ id, dir, version: check.version }, check.reason);
    else await this.#load(dir, check.manifest);
    return id;
  }

  async #load(dir: string, manifest: PluginManifest) {
    try {
      const module = await importServer(dir, manifest);
      this.#records.set(manifest.id, {
        id: manifest.id,
        dir,
        version: manifest.version,
        state: "loaded",
        manifest,
        module,
        revision: ++this.#revision,
      });
      this.log.info({ event: "plugin.loaded", id: manifest.id, version: manifest.version }, "Plugin loaded");
    } catch (err) {
      this.#refuse(
        { id: manifest.id, dir, version: manifest.version },
        `Server module failed to load: ${(err as Error).message}`,
      );
    }
  }

  #refuse(r: { id: string; dir: string; version?: string }, reason: string) {
    const record: PluginRecord = { ...r, state: "refused", refusal: reason, revision: ++this.#revision };
    this.#refused.push(record);
    this.log.warn({ event: "plugin.refused", id: r.id, reason }, `Plugin refused: ${reason}`);
  }

  isComposite(id: string): boolean {
    return Boolean(this.#records.get(id)?.manifest?.composes);
  }

  get(id: string): PluginRecord | undefined {
    return this.#records.get(id);
  }

  refusedById(id: string): PluginRecord | undefined {
    return this.#refused.find((r) => r.id === id);
  }

  loaded(): PluginRecord[] {
    return [...this.#records.values()];
  }

  all(): PluginRecord[] {
    return [...this.#records.values(), ...this.#refused];
  }

  manifestPath(id: string): string | undefined {
    const r = this.#records.get(id);
    return r && join(r.dir, MANIFEST_FILE);
  }

  timing(id: string): { interval: number; timeout: number } | undefined {
    const m = this.#records.get(id)?.manifest;
    if (!m) return undefined;
    return { interval: parseDuration(m.refresh.interval)!, timeout: parseDuration(m.refresh.timeout)! };
  }
}

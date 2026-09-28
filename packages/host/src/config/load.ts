import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { LineCounter, parseDocument } from "yaml";
import type { Logger } from "../log.ts";
import { checkBlocks } from "./blocks.ts";
import { configError, fromZod } from "./errors.ts";
import { locate } from "./locate.ts";
import { parseDuration } from "./primitives.ts";
import {
  blockSchema,
  blockUseSchema,
  dashboardSchema,
  includedFileSchema,
  pluginConfigSchema,
  rootFileSchema,
  themeSchema,
  widgetPlacementSchema,
} from "./schema.ts";
import type {
  BlockEntry,
  ConfigError,
  ConfigSet,
  DashboardEntry,
  DocPath,
  ErrorScope,
  LocatedPlacement,
  Source,
} from "./types.ts";
import { validatePlacements } from "./validate.ts";

export const ROOT_FILE = "opsdash.yaml";

/**
 * `--config` is either a directory containing `opsdash.yaml`, or a specific root file (for example
 * `config/production.yaml`), which lets several environments share one config directory and its includes.
 */
export function configLocation(path: string): { dir: string; rootFile: string } {
  const abs = resolve(path);
  const isFile = /\.ya?ml$/i.test(abs) || (existsSync(abs) && statSync(abs).isFile());
  return isFile ? { dir: dirname(abs), rootFile: basename(abs) } : { dir: abs, rootFile: ROOT_FILE };
}
const ROOT_ONLY = new Set(["version", "defaults", "theme"]);
const PARSE = { reportInput: true } as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function emptySet(dir: string): ConfigSet {
  return {
    dir,
    missing: false,
    valid: true,
    files: [],
    sources: [],
    defaults: { refreshInterval: 60_000, cacheWindow: 30_000, timeout: 10_000 },
    theme: {},
    plugins: {},
    dashboards: [],
    blocks: {},
    errors: [],
  };
}

function parsePlacements(raw: unknown[], src: Source, base: DocPath, scope: ErrorScope, errors: ConfigError[]) {
  const items: LocatedPlacement[] = [];
  raw.forEach((value, i) => {
    const path = [...base, i];
    const schema = isRecord(value) && "use" in value ? blockUseSchema : widgetPlacementSchema;
    const r = schema.safeParse(value, PARSE);
    if (r.success) items.push({ value: r.data, src, path } as LocatedPlacement);
    else errors.push(...fromZod(r.error.issues, src, path, scope));
  });
  return items;
}

/**
 * Loads `opsdash.yaml` and every file it includes (FR-001, FR-003). Each dashboard, block and plugin
 * entry is validated on its own so that an error only affects its scope (FR-009).
 */
export function loadConfig(path: string, log?: Logger): ConfigSet {
  const { dir, rootFile } = configLocation(path);
  const set = emptySet(dir);
  const rootAbs = join(set.dir, rootFile);
  if (!existsSync(rootAbs)) {
    set.missing = true;
    log?.warn({ event: "config.missing", dir: set.dir, file: rootFile }, `No ${rootFile} found in config directory`);
    return set;
  }

  const visited = new Set<string>();
  const declaredPlugins = new Set<string>();
  const dashboardIds = new Map<string, DashboardEntry>();
  let invalidCount = 0;

  const visit = (abs: string, chain: string[], from?: { src: Source; path: DocPath }) => {
    const rel = relative(set.dir, abs);
    if (chain.includes(abs)) {
      const cycle = [...chain.slice(chain.indexOf(abs)), abs].map((f) => relative(set.dir, f)).join(" → ");
      set.errors.push(configError(from!.src, from!.path, `Include cycle: ${cycle}.`, {}));
      set.valid = false;
      return;
    }
    if (visited.has(abs)) return;
    visited.add(abs);

    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      set.valid = false;
      if (from) set.errors.push(configError(from.src, from.path, `Included file "${rel}" does not exist.`, {}));
      return;
    }
    const lc = new LineCounter();
    const doc = parseDocument(text, { lineCounter: lc, prettyErrors: false, uniqueKeys: true });
    const src: Source = { file: rel, abs, doc, lc };
    set.files.push(rel);
    set.sources.push(src);
    if (doc.errors.length > 0) {
      set.valid = false;
      for (const e of doc.errors) {
        const pos = lc.linePos(e.pos[0]);
        const first = e.message.split("\n")[0]!;
        const message = `YAML syntax error: ${/[.!?]$/.test(first) ? first : `${first}.`}`;
        set.errors.push({ file: rel, line: pos.line, column: pos.col, path: "(syntax)", message, scope: {} });
      }
      return;
    }

    const data: unknown = doc.toJS() ?? {};
    const isRoot = chain.length === 0;
    const top = (isRoot ? rootFileSchema : includedFileSchema).safeParse(data, PARSE);
    if (!top.success) {
      set.errors.push(
        ...fromZod(top.error.issues, src, [], {}, (issue, msg) =>
          !isRoot && issue.code === "unrecognized_keys" && ROOT_ONLY.has(issue.keys[0]!)
            ? `Field "${issue.keys[0]}" is only allowed in the root file ${rootFile}.`
            : msg,
        ),
      );
    }
    if (!isRecord(data)) return;

    if (isRoot) {
      if (isRecord(data.defaults)) {
        for (const key of ["refreshInterval", "cacheWindow", "timeout"] as const) {
          const ms = typeof data.defaults[key] === "string" ? parseDuration(data.defaults[key]) : undefined;
          if (ms !== undefined) set.defaults[key] = ms;
        }
      }
      const theme = themeSchema.safeParse(data.theme ?? {});
      if (theme.success) set.theme = theme.data;
    }

    if (isRecord(data.plugins)) {
      for (const [id, value] of Object.entries(data.plugins)) {
        const path = ["plugins", id];
        const existing = set.plugins[id];
        if (declaredPlugins.has(id)) {
          const at = existing ? `${existing.src.file}:${locate(existing.src, existing.path).line}` : "another file";
          set.errors.push(configError(src, path, `Plugin "${id}" is already configured (${at}).`, { plugin: id }));
          continue;
        }
        declaredPlugins.add(id);
        const r = pluginConfigSchema.safeParse(value, PARSE);
        if (r.success) set.plugins[id] = { value: r.data, src, path };
        else set.errors.push(...fromZod(r.error.issues, src, path, { plugin: id }));
      }
    }

    if (Array.isArray(data.dashboards)) {
      data.dashboards.forEach((raw, i) => {
        const path = ["dashboards", i];
        const id =
          isRecord(raw) && typeof raw.id === "string" && /^[a-z0-9-]+$/.test(raw.id)
            ? raw.id
            : `~invalid-${++invalidCount}`;
        const scope = { dashboard: id };
        const title = isRecord(raw) && typeof raw.title === "string" ? raw.title : id;
        const entry: DashboardEntry = { id, title, src, path, items: [] };
        const r = dashboardSchema.safeParse(raw, PARSE);
        if (r.success) {
          entry.theme = r.data.theme;
          entry.items = parsePlacements(r.data.items, src, [...path, "items"], scope, set.errors);
          set.errors.push(...validatePlacements(entry.items, scope));
        } else set.errors.push(...fromZod(r.error.issues, src, path, scope));
        const dup = dashboardIds.get(id);
        if (dup) {
          const first = locate(dup.src, dup.path);
          set.errors.push(
            configError(
              src,
              [...path, "id"],
              `Duplicate dashboard id "${id}" (also defined at ${dup.src.file}:${first.line}:${first.column}).`,
              scope,
            ),
          );
          return;
        }
        dashboardIds.set(id, entry);
        set.dashboards.push(entry);
      });
    }

    if (isRecord(data.blocks)) {
      for (const [name, raw] of Object.entries(data.blocks)) {
        const path = ["blocks", name];
        const scope = { block: name };
        const dup = set.blocks[name];
        if (dup) {
          const first = locate(dup.src, dup.path);
          set.errors.push(
            configError(
              src,
              path,
              `Duplicate block name "${name}" (also defined at ${dup.src.file}:${first.line}:${first.column}).`,
              scope,
            ),
          );
          continue;
        }
        const entry: BlockEntry = { name, src, path, params: {}, items: [] };
        const r = blockSchema.safeParse(raw, PARSE);
        if (r.success) {
          entry.params = r.data.params ?? {};
          entry.items = parsePlacements(r.data.items, src, [...path, "items"], scope, set.errors);
          set.errors.push(...validatePlacements(entry.items, scope));
        } else set.errors.push(...fromZod(r.error.issues, src, path, scope));
        set.blocks[name] = entry;
      }
    }

    // Included files come after this file's own entries, so dashboards keep the order an operator reads.
    if (Array.isArray(data.include)) {
      data.include.forEach((inc, i) => {
        if (typeof inc === "string") visit(resolve(dirname(abs), inc), [...chain, abs], { src, path: ["include", i] });
      });
    }
  };

  visit(rootAbs, []);
  set.errors.push(...checkBlocks(set, declaredPlugins));
  for (const e of set.errors) log?.warn({ event: "config.error", ...e }, e.message);
  return set;
}

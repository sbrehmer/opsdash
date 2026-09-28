import { isSecretRef } from "@opsdash/plugin-sdk";
import semver from "semver";
import type { WidgetStatus } from "../../shared/api-types.ts";
import type { PluginRegistry } from "../plugins/registry.ts";
import type { Redactor } from "../secrets/redact.ts";
import { blocksUsed, type Expanded, expand } from "./blocks.ts";
import { fromZod } from "./errors.ts";
import { parseDuration } from "./primitives.ts";
import type { ThemeSpec, WidgetPlacement } from "./schema.ts";
import type { ConfigError, ConfigSet, DashboardEntry, Located } from "./types.ts";

export interface Placeholder {
  pluginId: string;
  requiredVersion?: string;
  reason: string;
}

export interface WidgetInstance {
  path: string;
  dashboardId: string;
  pluginId: string;
  title?: string;
  at: [number, number];
  size: [number, number];
  /** Validated settings; secrets are still `{ env }` references. */
  settings: Record<string, unknown>;
  status: WidgetStatus;
  placeholder?: Placeholder;
  blocks: string[];
}

export type ResolvedItem =
  | {
      kind: "widget";
      path: string;
      at: [number, number];
      size: [number, number];
      title?: string;
      pluginId: string;
      clientUrl?: string;
      styleUrl?: string;
      trackable: boolean;
      status: WidgetStatus;
      placeholder?: Placeholder;
      settings: Record<string, unknown>;
    }
  | { kind: "block"; id: string; at: [number, number]; size: [number, number]; items: ResolvedItem[] };

export interface ResolvedDashboard {
  id: string;
  title: string;
  theme: {
    mode: "light" | "dark" | "system";
    tokens: Record<string, string>;
    tokensLight: Record<string, string>;
    tokensDark: Record<string, string>;
  };
  errors: ConfigError[];
  items: ResolvedItem[];
}

export interface PluginRuntime {
  id: string;
  refreshInterval: number;
  cacheWindow: number;
  timeout: number;
  mockFaults: import("@opsdash/plugin-sdk").MockContextFaults;
  /** Blocking problems, e.g. a missing environment variable (FR-036). */
  issues: string[];
}

export interface ResolvedConfig {
  set: ConfigSet;
  errors: ConfigError[];
  dashboards: Map<string, ResolvedDashboard>;
  widgets: Map<string, WidgetInstance>;
  plugins: Map<string, PluginRuntime>;
  /** Dashboards whose own config (or a block on their chain) has errors. */
  invalidDashboards: Set<string>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isRecord(v) && isRecord(out[k]) && !isSecretRef(v) ? deepMerge(out[k] as Record<string, unknown>, v) : v;
  }
  return out;
}

/** Removes every `{ env }` secret reference so settings can be sent to the browser (FR-035). */
export function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => !isSecretRef(v))
      .map(([k, v]) => [k, stripSecrets(v)]),
  );
}

function collectEnvRefs(value: unknown, out = new Set<string>()): Set<string> {
  if (isSecretRef(value)) out.add(value.env);
  else if (Array.isArray(value)) for (const v of value) collectEnvRefs(v, out);
  else if (isRecord(value)) for (const v of Object.values(value)) collectEnvRefs(v, out);
  return out;
}

function mergeTheme(global: ThemeSpec, local?: ThemeSpec): ResolvedDashboard["theme"] {
  return {
    mode: local?.mode ?? global.mode ?? "system",
    tokens: { ...global.tokens, ...local?.tokens } as Record<string, string>,
    tokensLight: { ...global["tokens-light"], ...local?.["tokens-light"] } as Record<string, string>,
    tokensDark: { ...global["tokens-dark"], ...local?.["tokens-dark"] } as Record<string, string>,
  };
}

export interface ResolveOptions {
  mock: boolean;
  env: Map<string, string>;
  redactor: Redactor;
}

/** Turns a loaded config set into dashboards and widget instances for the given plugins. */
export function resolveConfig(set: ConfigSet, registry: PluginRegistry, opts: ResolveOptions): ResolvedConfig {
  const errors = [...set.errors];
  const dashboards = new Map<string, ResolvedDashboard>();
  const widgets = new Map<string, WidgetInstance>();
  const plugins = new Map<string, PluginRuntime>();
  const invalidDashboards = new Set<string>();
  const envRefs = new Map<string, Set<string>>();

  for (const [id, cfg] of Object.entries(set.plugins)) {
    const timing = registry.timing(id);
    const c = cfg.value;
    plugins.set(id, {
      id,
      refreshInterval: parseDuration(c.refreshInterval ?? "") ?? timing?.interval ?? set.defaults.refreshInterval,
      cacheWindow: parseDuration(c.cacheWindow ?? "") ?? set.defaults.cacheWindow,
      timeout: parseDuration(c.timeout ?? "") ?? timing?.timeout ?? set.defaults.timeout,
      mockFaults: c.mock ?? {},
      issues: [],
    });
  }

  const resolveWidget = (d: DashboardEntry, e: Extract<Expanded, { kind: "widget" }>): ResolvedItem => {
    const w: WidgetPlacement = e.placement;
    const pluginCfg = set.plugins[w.plugin] as
      | Located<{ version: string; settings?: Record<string, unknown> }>
      | undefined;
    const record = registry.get(w.plugin);
    const merged = deepMerge(pluginCfg?.value.settings ?? {}, w.settings ?? {});
    const required = pluginCfg?.value.version;
    const instance: WidgetInstance = {
      path: e.path,
      dashboardId: d.id,
      pluginId: w.plugin,
      title: w.title,
      at: w.at,
      size: w.size,
      settings: merged,
      status: "ok",
      blocks: e.blocks,
    };

    if (!record) {
      const refused = registry.refusedById(w.plugin);
      instance.status = refused ? "plugin-refused" : "plugin-missing";
      instance.placeholder = {
        pluginId: w.plugin,
        requiredVersion: required,
        reason: refused ? `Plugin was refused: ${refused.refusal}` : `Plugin "${w.plugin}" is not installed`,
      };
    } else if (required && !semver.satisfies(record.version!, required)) {
      instance.status = "plugin-incompatible";
      instance.placeholder = {
        pluginId: w.plugin,
        requiredVersion: required,
        reason: `Installed version ${record.version} does not satisfy ${required}`,
      };
    } else {
      const r = record.module!.settings.safeParse(merged, { reportInput: true });
      if (r.success) {
        instance.settings = r.data as Record<string, unknown>;
        const refs = envRefs.get(w.plugin) ?? new Set();
        collectEnvRefs(merged, refs);
        envRefs.set(w.plugin, refs);
      } else {
        instance.status = "invalid";
        for (const issue of r.error.issues) {
          const key = issue.path[0];
          const inWidget = key !== undefined && w.settings && String(key) in w.settings;
          const src = inWidget || !pluginCfg ? e.located.src : pluginCfg.src;
          const base = inWidget || !pluginCfg ? [...e.located.path, "settings"] : [...pluginCfg.path, "settings"];
          errors.push(...fromZod([issue], src, base, { dashboard: d.id }));
        }
      }
    }
    widgets.set(e.path, instance);
    return {
      kind: "widget",
      path: e.path,
      at: w.at,
      size: w.size,
      title: w.title,
      pluginId: w.plugin,
      clientUrl: record ? `/plugins/${record.id}/client.js?v=${record.revision}` : undefined,
      styleUrl: record?.manifest?.style ? `/plugins/${record.id}/style.css?v=${record.revision}` : undefined,
      trackable: record?.manifest?.capabilities.includes("track") ?? false,
      status: instance.status,
      placeholder: instance.placeholder,
      settings: stripSecrets(instance.settings) as Record<string, unknown>,
    };
  };

  const resolveItems = (d: DashboardEntry, items: Expanded[]): ResolvedItem[] =>
    items.map((e) =>
      e.kind === "widget"
        ? resolveWidget(d, e)
        : { kind: "block", id: e.id, at: e.at, size: e.size, items: resolveItems(d, e.items) },
    );

  for (const d of set.dashboards) {
    const items = resolveItems(d, expand(set, d.items, d.id));
    const chain = blocksUsed(set, d.items);
    const usedPlugins = new Set([...widgets.values()].filter((w) => w.dashboardId === d.id).map((w) => w.pluginId));
    const own = errors.filter(
      (e) =>
        e.scope.dashboard === d.id ||
        (e.scope.block !== undefined && chain.has(e.scope.block)) ||
        (e.scope.plugin !== undefined && usedPlugins.has(e.scope.plugin)),
    );
    if (own.length > 0) {
      invalidDashboards.add(d.id);
      for (const w of widgets.values()) if (w.dashboardId === d.id && w.status === "ok") w.status = "invalid";
    }
    dashboards.set(d.id, {
      id: d.id,
      title: d.title,
      theme: mergeTheme(set.theme, d.theme),
      errors: own,
      items: own.length > 0 ? [] : items,
    });
  }

  for (const record of registry.loaded()) {
    for (const name of record.manifest!.env) opts.redactor.register(opts.env.get(name));
    const runtime = plugins.get(record.id);
    if (!runtime || opts.mock) continue;
    for (const name of envRefs.get(record.id) ?? []) {
      if (!opts.env.has(name)) runtime.issues.push(`${name} missing for plugin ${record.id}`);
    }
  }

  return { set, errors, dashboards, widgets, plugins, invalidDashboards };
}

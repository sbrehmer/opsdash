import type { z } from "zod";

/** Plugin API version implemented by this SDK (independent of the app version). */
export const PLUGIN_API_VERSION = "1.1.0";

/** The `opsdash` block authors write in package.json. Paths are relative to `dist/`. */
export interface PluginManifestSource {
  id: string;
  apiVersion: string;
  server: string;
  client: string;
  capabilities: string[];
  env: string[];
  refresh: { interval: string; timeout: string };
  maxBatchSize?: number;
  /** API 1.1: makes this a composite plugin whose widget shows references owned by these plugins. */
  composes?: string[];
}

/** The generated `dist/opsdash.manifest.json`: the complete manifest the host reads. */
export interface PluginManifest extends PluginManifestSource {
  name: string;
  version: string;
  settingsSchema: unknown;
  /** Absent for composite plugins (no source). */
  referenceSchema?: unknown;
  /** Not required for composite plugins (no source). */
  hasMock?: boolean;
  style?: string;
}

export type FetchResult = { data: unknown } | { error: string };
export type FetchResults = Map<string, FetchResult>;
export type ParseResult<Ref> = { ok: Ref } | { error: string };

export interface StoredRef<Ref = unknown> {
  id: number;
  pluginId: string;
  widgetPath: string;
  refKey: string;
  ref: Ref;
}

export interface MockFaults {
  notFound: string[];
  errorKeys: string[];
  omitKeys: string[];
  extraKeys: string[];
  latencyMs: number;
  errorRate: number;
}

export interface MockContextFaults extends Partial<MockFaults> {
  /** API 1.1: plugin-specific mock scenario from config `plugins.<id>.mock.scenario`. */
  scenario?: Record<string, unknown>;
}

export interface PluginContext<Settings = unknown> {
  settings: Settings;
  secrets: { get(name: string): string };
  signal: AbortSignal;
  log: {
    debug(obj: object | string, msg?: string): void;
    info(obj: object | string, msg?: string): void;
    warn(obj: object | string, msg?: string): void;
    error(obj: object | string, msg?: string): void;
  };
  state: {
    get<T = unknown>(key: string): T | undefined;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    list(): Array<{ key: string; value: unknown }>;
  };
  refs: { find(pluginId: string, refKey: string): StoredRef[] };
  links: {
    create(fromRefId: number, toRefId: number): void;
    remove(fromRefId: number, toRefId: number): void;
    list(refId: number): Array<{ fromRefId: number; toRefId: number; createdBy: string }>;
  };
  mock: boolean;
  /** Fault settings from `plugins.<id>.mock` in config; only meaningful in mock mode. */
  mockFaults: MockContextFaults;
  /** API 1.1: ask for this plugin's next refresh after `ms` (once; never overlapping). */
  scheduleNext(ms: number): void;
  /** API 1.1: use another plugin through the host (its own settings, secrets and state). */
  plugins: {
    parse(pluginId: string, input: string): Promise<ParseResult<unknown>>;
    resolve(pluginId: string, name: string, input: unknown): Promise<unknown>;
  };
}

export type ActionResult = { ok: true; message?: string } | { error: string };

/** API 1.1: the calling widget, available to actions and `onData`. Changes only Opsdash's own store. */
export interface WidgetHandle<Settings = unknown> {
  path: string;
  settings: Settings;
  refs(): StoredRef[];
  links(): Array<{ from: number; to: number }>;
  /** Validates with the owning plugin's reference schema; returns the existing ref when already tracked. */
  track(pluginId: string, ref: unknown): StoredRef;
  /** With `cascade`, also removes linked refs in this widget that are left without links. */
  untrack(refId: number, opts?: { cascade?: boolean }): void;
  link(fromId: number, toId: number): void;
  unlink(fromId: number, toId: number): void;
  transaction<T>(fn: () => T): T;
}

export interface ActionContext<Settings = unknown> extends PluginContext<Settings> {
  widget: WidgetHandle<Settings>;
}

export type Action<Settings = unknown> = (
  payload: unknown,
  ctx: ActionContext<Settings>,
) => Promise<ActionResult> | ActionResult;

export interface CompositeItem {
  plugin: string;
  id: number;
  refKey: string;
  ref: unknown;
  data?: unknown;
  error?: string;
  state?: "ok" | "stale" | "error" | "timeout" | "loading";
  lastSuccessAt?: number;
}

export interface CompositeWidgetData {
  path: string;
  items: CompositeItem[];
  links: Array<{ from: number; to: number }>;
}

export type Resolver<Settings = unknown> = (input: unknown, ctx: PluginContext<Settings>) => Promise<unknown> | unknown;

export interface WidgetNeedsInput<Settings, Ref> {
  path: string;
  settings: Settings;
  trackedRefs: Ref[];
}

export interface Source<Settings, Ref> {
  parseReference(input: string, ctx: PluginContext<Settings>): Promise<ParseResult<Ref>> | ParseResult<Ref>;
  fetch(refs: Ref[], ctx: PluginContext<Settings>): Promise<FetchResults>;
  /** API 1.1: helpers other plugins may call through `ctx.plugins.resolve`. */
  resolvers?: Record<string, Resolver<Settings>>;
}

export interface PluginDefinition<S extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType>
  extends Source<z.output<S>, z.output<R>> {
  settings: S;
  reference: R;
  refKey(ref: z.output<R>): string;
  /** The second argument (API 1.1) groups per reference, for example per Jenkins pipeline. */
  batchKey?(settings: z.output<S>, ref: z.output<R>): string;
  needs?(widget: WidgetNeedsInput<z.output<S>, z.output<R>>): z.output<R>[];
  mock: Source<z.output<S>, z.output<R>>;
  /** API 1.1 (capability "actions"): named operations on the calling widget's tracked items. */
  actions?: Record<string, Action<z.output<S>>>;
}

/** API 1.1: a plugin without a source whose widget shows items owned by the plugins it `composes`. */
export interface CompositePluginDefinition<S extends z.ZodType = z.ZodType> {
  settings: S;
  actions?: Record<string, Action<z.output<S>>>;
  /** Called after the host assembles the widget's data; may prune rows and return `meta` for the client. */
  onData?(
    data: CompositeWidgetData,
    ctx: ActionContext<z.output<S>>,
  ): Promise<{ meta?: unknown } | undefined> | { meta?: unknown } | undefined;
}

/** What `definePlugin` returns: the definition plus schema export used at build time. */
export type DefinedPlugin<S extends z.ZodType = z.ZodType, R extends z.ZodType = z.ZodType> = PluginDefinition<S, R> & {
  jsonSchemas(): { settingsSchema: unknown; referenceSchema?: unknown };
  onData?: CompositePluginDefinition<S>["onData"];
};

/** What a composite `definePlugin` returns. Source members are absent at runtime. */
export type DefinedComposite<S extends z.ZodType = z.ZodType> = CompositePluginDefinition<S> & {
  jsonSchemas(): { settingsSchema: unknown };
};

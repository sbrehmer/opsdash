import type { Document, LineCounter } from "yaml";
import type { BlockUse, PluginConfig, ThemeSpec, WidgetPlacement } from "./schema.ts";

export type DocPath = Array<string | number>;

/** A loaded config file. */
export interface Source {
  file: string; // relative to the config dir
  abs: string;
  doc: Document;
  lc: LineCounter;
}

export interface ErrorScope {
  dashboard?: string;
  block?: string;
  plugin?: string;
}

export interface ConfigError {
  file: string;
  line: number;
  column: number;
  path: string;
  message: string;
  scope: ErrorScope;
}

export interface Located<T> {
  value: T;
  src: Source;
  path: DocPath;
}

export type LocatedPlacement = Located<WidgetPlacement> | Located<BlockUse>;

export interface DashboardEntry {
  id: string;
  title: string;
  src: Source;
  path: DocPath;
  theme?: ThemeSpec;
  items: LocatedPlacement[];
}

export interface BlockEntry {
  name: string;
  src: Source;
  path: DocPath;
  params: Record<string, { default?: string }>;
  items: LocatedPlacement[];
}

export interface Defaults {
  refreshInterval: number;
  cacheWindow: number;
  timeout: number;
}

export interface ConfigSet {
  dir: string;
  missing: boolean;
  /** False if any file failed to parse (YAML syntax or unreadable). */
  valid: boolean;
  files: string[];
  sources: Source[];
  defaults: Defaults;
  theme: ThemeSpec;
  plugins: Record<string, Located<PluginConfig>>;
  dashboards: DashboardEntry[];
  blocks: Record<string, BlockEntry>;
  errors: ConfigError[];
}

export const isBlockUse = (p: LocatedPlacement): p is Located<BlockUse> => "use" in p.value;

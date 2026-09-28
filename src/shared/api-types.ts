/** Types of the HTTP and SSE payloads exchanged between the server and the browser client. */

export interface DashboardSummary {
  id: string;
  title: string;
  status: "ok" | "invalid";
  errorCount: number;
}

export interface ConfigError {
  file: string;
  line: number;
  column: number;
  path: string;
  message: string;
}

export interface DashboardTheme {
  mode: "light" | "dark" | "system";
  tokens: Record<string, string>;
  tokensLight: Record<string, string>;
  tokensDark: Record<string, string>;
}

export type WidgetStatus = "ok" | "invalid" | "plugin-missing" | "plugin-incompatible" | "plugin-refused";

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
      placeholder?: { pluginId: string; requiredVersion?: string; reason: string };
      settings: Record<string, unknown>;
    }
  | { kind: "block"; id: string; at: [number, number]; size: [number, number]; items: ResolvedItem[] };

export interface ResolvedDashboard {
  id: string;
  title: string;
  theme: DashboardTheme;
  errors: ConfigError[];
  items: ResolvedItem[];
}

export interface Meta {
  version: string;
  pluginApiVersion: string;
  mock: boolean;
}

export type WidgetState = "loading" | "ok" | "empty" | "error" | "stale" | "timeout";

export interface WidgetData {
  path: string;
  state: WidgetState;
  items: Array<{
    plugin?: string;
    id?: number;
    state?: "ok" | "stale" | "error" | "timeout" | "loading";
    lastSuccessAt?: number;
    refKey: string;
    ref: unknown;
    data?: unknown;
    error?: string;
  }>;
  /** Links between items of a composite widget (stored reference ids). */
  links?: Array<{ from: number; to: number }>;
  /** Extra data from a composite plugin's `onData`. */
  meta?: unknown;
  fetchedAt?: number;
  lastSuccessAt?: number;
  error?: string;
}

export type ActionResult = { ok: true; message?: string } | { error: string };

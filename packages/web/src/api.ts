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

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

export type ActionResult = { ok: true; message?: string } | { error: string };

/** Runs a widget action on the server; non-2xx responses resolve to `{ error }`. */
export async function runAction(path: string, name: string, payload?: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(`/api/widgets/${encodeURIComponent(path)}/actions/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (!res.ok) return { error: typeof body.error === "string" ? body.error : `Action failed (${res.status})` };
    return body as ActionResult;
  } catch (err) {
    return { error: `Action failed: ${(err as Error).message}` };
  }
}

export const widgetUrl = (path: string) => `/api/widgets/${encodeURIComponent(path)}/items`;

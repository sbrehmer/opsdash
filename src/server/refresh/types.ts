export type WidgetState = "loading" | "ok" | "empty" | "error" | "stale" | "timeout";
export type ItemState = "ok" | "stale" | "error" | "timeout" | "loading";

export interface WidgetItem {
  /** Owning plugin (API 1.1). */
  plugin?: string;
  /** Stored reference id (composite widgets, API 1.1). */
  id?: number;
  refKey: string;
  ref: unknown;
  data?: unknown;
  error?: string;
  /** Per-item freshness (composite widgets, API 1.1). */
  state?: ItemState;
  lastSuccessAt?: number;
}

/** Pushed to browsers over SSE (contracts/http-api.md). */
export interface WidgetData {
  path: string;
  state: WidgetState;
  items: WidgetItem[];
  fetchedAt?: number;
  lastSuccessAt?: number;
  error?: string;
  /** Composite widgets (API 1.1): links between items' stored ref ids, and plugin-provided meta. */
  links?: Array<{ from: number; to: number }>;
  meta?: unknown;
}

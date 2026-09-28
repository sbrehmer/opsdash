import type { ComponentType } from "preact";

export type WidgetState = "loading" | "ok" | "empty" | "error" | "stale" | "timeout";

export interface WidgetItem<Ref = unknown, Data = unknown> {
  /** Owning plugin (API 1.1). */
  plugin?: string;
  /** Stored reference id, for composite widgets (API 1.1). */
  id?: number;
  /** Per-item freshness, for composite widgets (API 1.1). */
  state?: "ok" | "stale" | "error" | "timeout" | "loading";
  lastSuccessAt?: number;
  refKey: string;
  ref: Ref;
  data?: Data;
  error?: string;
}

export interface WidgetProps<Settings = Record<string, unknown>, Ref = unknown, Data = unknown> {
  items: WidgetItem<Ref, Data>[];
  state: WidgetState;
  lastSuccessAt?: number;
  error?: string;
  /** Settings with secret references removed. */
  settings: Settings;
  title?: string;
  /** Links between items of a composite widget (stored reference ids, API 1.1). */
  links?: Array<{ from: number; to: number }>;
  /** Extra data from the composite plugin's `onData` (API 1.1). */
  meta?: unknown;
  /** Runs a widget action on the server (API 1.1, capability "actions"). */
  actions: { run(name: string, payload?: unknown): Promise<ActionResult> };
}

export type ActionResult = { ok: true; message?: string } | { error: string };

export interface WidgetDefinition<Settings = Record<string, unknown>, Ref = unknown, Data = unknown> {
  render: ComponentType<WidgetProps<Settings, Ref, Data>>;
  /**
   * States the widget renders itself. States not listed use the host's default presentation
   * (FR-041). By default the host handles `loading`, `empty`, `error` and `timeout`.
   */
  handlesStates?: WidgetState[];
}

/** Declares a plugin's widget (client module default export). */
export function defineWidget<Settings = Record<string, unknown>, Ref = unknown, Data = unknown>(
  def: WidgetDefinition<Settings, Ref, Data>,
): WidgetDefinition<Settings, Ref, Data> {
  return def;
}

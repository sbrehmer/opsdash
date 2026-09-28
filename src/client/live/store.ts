import { type Signal, signal } from "@preact/signals";
import type { WidgetData } from "../../shared/api-types.ts";

const widgets = new Map<string, Signal<WidgetData | undefined>>();

/** Per-widget live data, updated from server-sent events. */
export function widgetSignal(path: string): Signal<WidgetData | undefined> {
  let s = widgets.get(path);
  if (!s) {
    s = signal<WidgetData | undefined>(undefined);
    widgets.set(path, s);
  }
  return s;
}

export interface LiveHandlers {
  onDashboardChanged(id: string): void;
  onDashboardsChanged(): void;
  onPluginReloaded(id: string, clientUrl?: string): void;
}

/** Subscribes to one dashboard's event stream; EventSource reconnects on its own after a restart. */
export function connect(dashboardId: string, handlers: LiveHandlers): () => void {
  const es = new EventSource(`/api/events?dashboard=${encodeURIComponent(dashboardId)}`);
  const put = (d: WidgetData) => {
    widgetSignal(d.path).value = d;
  };
  es.addEventListener("snapshot", (e) => {
    const { widgets: list } = JSON.parse((e as MessageEvent).data) as { widgets: WidgetData[] };
    for (const d of list) {
      // Keep showing known data while a reconnect snapshot says "loading".
      if (d.state === "loading" && widgetSignal(d.path).value) continue;
      put(d);
    }
  });
  es.addEventListener("widget-data", (e) => put(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("dashboard-changed", (e) => handlers.onDashboardChanged(JSON.parse((e as MessageEvent).data).id));
  es.addEventListener("dashboards-changed", () => handlers.onDashboardsChanged());
  es.addEventListener("plugin-reloaded", (e) => {
    const { id, clientUrl } = JSON.parse((e as MessageEvent).data) as { id: string; clientUrl?: string };
    handlers.onPluginReloaded(id, clientUrl);
  });
  return () => es.close();
}

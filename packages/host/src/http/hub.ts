import type { WidgetData } from "../refresh/types.ts";

type Send = (event: string, data: unknown) => void;

/** Tracks SSE subscribers per dashboard; the union of their dashboards is the visible set (FR-022). */
export class EventHub {
  #subs = new Map<number, { dashboardId: string; send: Send }>();
  #next = 0;

  subscribe(dashboardId: string, send: Send): () => void {
    const id = ++this.#next;
    this.#subs.set(id, { dashboardId, send });
    return () => this.#subs.delete(id);
  }

  viewedDashboards(): Set<string> {
    return new Set([...this.#subs.values()].map((s) => s.dashboardId));
  }

  subscriberCount(): number {
    return this.#subs.size;
  }

  publishWidget(data: WidgetData): void {
    const dashboardId = data.path.split("/")[0];
    this.toDashboard(dashboardId!, "widget-data", data);
  }

  toDashboard(dashboardId: string, event: string, data: unknown): void {
    for (const s of this.#subs.values()) if (s.dashboardId === dashboardId) s.send(event, data);
  }

  broadcast(event: string, data: unknown): void {
    for (const s of this.#subs.values()) s.send(event, data);
  }
}

import type { ComponentChildren } from "preact";
import type { ResolvedItem } from "../api.ts";
import css from "./grid.module.css";

export interface GridProps {
  items: ResolvedItem[];
  renderWidget(item: Extract<ResolvedItem, { kind: "widget" }>): ComponentChildren;
}

/** Placement → CSS grid area; on narrow screens the order is row, then column (FR-002b). */
export function cellStyle(at: [number, number], size: [number, number]): Record<string, string> {
  return {
    "--col": String(at[0]),
    "--row": String(at[1]),
    "--w": String(size[0]),
    "--h": String(size[1]),
    "--order": String(at[1] * 100 + at[0]),
  };
}

/** The 12-column grid. Block uses render their own 12-column sub-grid inside their area. */
export function Grid({ items, renderWidget }: GridProps) {
  return (
    <div class={css.grid}>
      {items.map((item) => (
        <div
          key={item.kind === "widget" ? item.path : item.id}
          class={css.cell}
          style={cellStyle(item.at, item.size)}
          data-testid={item.kind === "widget" ? `cell-${item.path}` : `block-${item.id}`}
        >
          {item.kind === "widget" ? renderWidget(item) : <Grid items={item.items} renderWidget={renderWidget} />}
        </div>
      ))}
    </div>
  );
}

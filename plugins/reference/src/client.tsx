import { defineWidget } from "@opsdash/plugin-sdk/client";
import type { ReferenceItem, ReferenceRef } from "./source.ts";
import css from "./widget.module.css";

const dotClass = { open: css.open, "in-progress": css.progress, done: css.done } as const;

export default defineWidget<{ view: "list" | "compact" }, ReferenceRef, ReferenceItem>({
  render: ({ items, settings }) => (
    <ul class={`${css.list} ${settings.view === "compact" ? css.compact : ""}`}>
      {items.map((item) => (
        <li key={item.refKey} class={css.item}>
          <span class={`${css.dot} ${item.data ? dotClass[item.data.status] : ""}`} aria-hidden="true" />
          <span class={css.key}>{item.refKey}</span>
          {item.data ? (
            <span class={css.title}>
              {item.data.title}
              <span class="od-visually-hidden"> ({item.data.status})</span>
            </span>
          ) : (
            <span class={`${css.title} ${css.error}`}>{item.error}</span>
          )}
        </li>
      ))}
    </ul>
  ),
});

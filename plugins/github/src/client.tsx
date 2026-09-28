import { defineWidget } from "@opsdash/plugin-sdk/client";
import { PrCell, type PullRequest } from "#delivery-cells";
import css from "./list.module.css";

/** Standalone GitHub list (T046): one PrCell per tracked pull request. */
export default defineWidget<Record<string, unknown>, unknown, PullRequest>({
  render: ({ items }) => (
    <ul class={css.list}>
      {items.map((item) => (
        <li key={item.refKey} class={css.item}>
          <PrCell item={item} />
        </li>
      ))}
    </ul>
  ),
});

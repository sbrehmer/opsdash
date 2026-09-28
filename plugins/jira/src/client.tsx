import { type JiraIssue, StoryCell } from "@opsdash/delivery-cells";
import { defineWidget } from "@opsdash/plugin-sdk/client";
import css from "./list.module.css";

/** Standalone Jira list (T045): one StoryCell per tracked issue. */
export default defineWidget<Record<string, unknown>, unknown, JiraIssue>({
  render: ({ items }) => (
    <ul class={css.list}>
      {items.map((item) => (
        <li key={item.refKey} class={css.item}>
          <StoryCell item={item} />
        </li>
      ))}
    </ul>
  ),
});

import { BuildCell, type JenkinsJob, RelativeTime } from "@opsdash/delivery-cells";
import { defineWidget } from "@opsdash/plugin-sdk/client";
import css from "./list.module.css";

/** Standalone Jenkins list (T047): one BuildCell per tracked job, plus the main branch's last success. */
export default defineWidget<Record<string, unknown>, unknown, JenkinsJob>({
  render: ({ items }) => (
    <ul class={css.list}>
      {items.map((item) => {
        const main = item.data?.main;
        return (
          <li key={item.refKey} class={css.item}>
            <BuildCell item={item} />
            {main && (
              <p class={css.main}>
                {main.branch}:{" "}
                {main.lastSuccessAt != null ? (
                  <>
                    last success <RelativeTime at={main.lastSuccessAt} />
                  </>
                ) : (
                  "no successful build"
                )}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  ),
});

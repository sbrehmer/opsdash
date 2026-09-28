import type { WidgetState } from "../../shared/api-types.ts";
import css from "./widget.module.css";

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
};

/** Host default presentations for widget states (FR-041). */
export function DefaultState({ state, error }: { state: WidgetState; error?: string }) {
  switch (state) {
    case "loading":
      return (
        <div class={css.skeleton} role="status" aria-label="Loading">
          <span />
          <span />
          <span />
        </div>
      );
    case "empty":
      return <p class={css.state}>Nothing to show yet.</p>;
    case "timeout":
      return (
        <p class={`${css.state} ${css.stateError}`} role="alert">
          The source did not respond in time.
        </p>
      );
    default:
      return (
        <p class={`${css.state} ${css.stateError}`} role="alert">
          {error ?? "Something went wrong."}
        </p>
      );
  }
}

export function StaleNotice({ lastSuccessAt, error }: { lastSuccessAt?: number; error?: string }) {
  return (
    <p class={css.stale} role="status">
      Showing data from {lastSuccessAt ? ago(lastSuccessAt) : "earlier"}: the last refresh failed
      {error ? ` (${error})` : ""}.
    </p>
  );
}

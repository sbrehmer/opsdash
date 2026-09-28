import type { ConfigError } from "../api.ts";
import css from "./dashboard.module.css";

/** A dashboard's configuration errors, shown instead of its content (US2). */
export function Errors({ errors }: { errors: ConfigError[] }) {
  return (
    <div class={css.errors} role="alert">
      <h2>
        This dashboard has {errors.length} configuration {errors.length === 1 ? "error" : "errors"}
      </h2>
      <ul>
        {errors.map((e) => (
          <li key={`${e.file}:${e.line}:${e.column}:${e.message}`}>
            <div class={css.location}>
              {e.file}:{e.line}:{e.column} {e.path}
            </div>
            <div>{e.message}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

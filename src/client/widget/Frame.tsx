import type { ComponentChildren } from "preact";
import css from "./widget.module.css";

export interface FrameProps {
  id: string;
  title?: string;
  controls?: ComponentChildren;
  controlsOpen?: boolean;
  placeholder?: boolean;
  children: ComponentChildren;
}

/** Minimal widget chrome; controls are revealed on hover or focus (FR-039). */
export function Frame({ id, title, controls, controlsOpen, placeholder, children }: FrameProps) {
  const headingId = `w-${id.replace(/[^a-zA-Z0-9-]/g, "-")}`;
  return (
    <section class={`${css.frame} ${placeholder ? css.placeholder : ""}`} aria-labelledby={headingId} data-widget={id}>
      <header class={css.header}>
        <h2 id={headingId} class={css.title}>
          {title ?? id.split("/").at(-1)}
        </h2>
        {controls && (
          <div class={css.controls} data-open={controlsOpen ? "true" : "false"}>
            {controls}
          </div>
        )}
      </header>
      <div class={css.body}>{children}</div>
    </section>
  );
}

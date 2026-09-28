import type { DashboardTheme } from "../api.ts";

const STYLE_ID = "od-theme-overrides";

const block = (selector: string, tokens: Record<string, string>) => {
  const decls = Object.entries(tokens)
    .map(([k, v]) => `--od-${k}: ${v.replace(/[;{}<>]/g, "")};`)
    .join(" ");
  return decls ? `${selector} { ${decls} }` : "";
};

/** Applies a dashboard's theme mode and token overrides to the document root. */
export function applyTheme(theme: DashboardTheme, doc: Document = document): void {
  doc.documentElement.dataset.theme = theme.mode;
  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = [
    block(":root[data-theme]", theme.tokens),
    block(':root[data-theme="light"]', theme.tokensLight),
    block(':root[data-theme="dark"]', theme.tokensDark),
    theme.mode === "system"
      ? `@media (prefers-color-scheme: light) { ${block(':root[data-theme="system"]', theme.tokensLight)} }`
      : "",
    theme.mode === "system"
      ? `@media (prefers-color-scheme: dark) { ${block(':root[data-theme="system"]', theme.tokensDark)} }`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

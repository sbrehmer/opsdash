import * as signals from "@preact/signals";
import * as preact from "preact";
import * as hooks from "preact/hooks";
import * as jsxRuntime from "preact/jsx-runtime";
import "./theme/tokens.css";
import "./theme/base.css";
import { App } from "./app.tsx";

// Plugin widgets import these through the page's import map (served as /vendor shims by the host),
// so every widget shares this page's single Preact instance.
(globalThis as { __opsdash_shared?: Record<string, unknown> }).__opsdash_shared = {
  preact,
  "preact/hooks": hooks,
  "preact/jsx-runtime": jsxRuntime,
  "@preact/signals": signals,
};

preact.render(<App />, document.getElementById("app")!);

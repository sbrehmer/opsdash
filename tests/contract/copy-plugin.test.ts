import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type Harness, sse, start, writeConfig } from "../../tests/server/helpers.ts";
import { copyReference } from "../fixtures/plugins/variants.ts";
import { ROOT } from "./helpers.ts";

const WORK = join(ROOT, "tests/.tmp", `copy-${process.pid}`);
let h: Harness | undefined;
afterAll(async () => {
  await h?.close();
  rmSync(WORK, { recursive: true, force: true });
});

describe("a copied plugin works without host changes (US8, FR-020)", () => {
  it("builds in the third-party shape with the SDK preset and renders next to the original", async () => {
    // Third-party shape (003 US4, FR-010): its own package.json with an "opsdash" field and a
    // vite.config.ts, unlike the built-in plugins (plugin.json only). Dependencies resolve from the
    // repository root install, like an external project that installed the SDK and Vite.
    const pluginsDir = join(WORK, "plugins");
    const copy = join(pluginsDir, "copy");
    const source = join(ROOT, "plugins/reference");
    mkdirSync(copy, { recursive: true });
    cpSync(join(source, "src"), join(copy, "src"), { recursive: true });
    const { name: _name, version: _version, ...fields } = JSON.parse(readFileSync(join(source, "plugin.json"), "utf8"));
    const pkg = { name: "@acme/opsdash-copy", version: "1.0.0", type: "module", opsdash: { ...fields, id: "copy" } };
    writeFileSync(join(copy, "package.json"), JSON.stringify(pkg, null, 2));
    writeFileSync(
      join(copy, "vite.config.ts"),
      `import { opsdashPlugin } from "@opsdash/plugin-sdk/vite";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [opsdashPlugin()] });
`,
    );
    const client = join(copy, "src/client.tsx");
    writeFileSync(client, readFileSync(client, "utf8").replace("{item.refKey}</span>", "Copy of {item.refKey}</span>"));
    execFileSync(process.execPath, [join(ROOT, "node_modules/vite/bin/vite.js"), "build", "--logLevel", "error"], {
      cwd: copy,
    });
    copyReference(pluginsDir);

    const configDir = writeConfig({
      "opsdash.yaml": `version: 1
plugins:
  reference: { version: "^1.0.0" }
  copy: { version: "^1.0.0" }
dashboards:
  - id: d
    title: D
    items:
      - { id: original, plugin: reference, at: [1, 1], size: [6, 2], settings: { items: ["ITEM-1"] } }
      - { id: copied, plugin: copy, at: [7, 1], size: [6, 2], settings: { items: ["ITEM-1"] } }
`,
    });
    h = await start({ configDir, pluginsDir });
    const status = await (await fetch(`${h.ops.url}/api/status`)).json();
    expect(status.plugins.map((p: { id: string; state: string }) => `${p.id}:${p.state}`).sort()).toEqual([
      "copy:loaded",
      "reference:loaded",
    ]);
    const events = await sse(h.ops.url, "d");
    await events.waitFor((e) => e.event === "widget-data" && e.data.path === "d/copied" && e.data.state === "ok");
    await events.waitFor((e) => e.event === "widget-data" && e.data.path === "d/original" && e.data.state === "ok");
    events.close();
    const js = await (await fetch(`${h.ops.url}/plugins/copy/client.js`)).text();
    expect(js).toContain("Copy of ");
  });
});

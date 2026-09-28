import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type Harness, sse, start, writeConfig } from "../../packages/host/tests/helpers.ts";
import { copyReference } from "../fixtures/plugins/variants.ts";
import { ROOT } from "./helpers.ts";

const WORK = join(ROOT, "tests/.tmp", `copy-${process.pid}`);
let h: Harness | undefined;
afterAll(async () => {
  await h?.close();
  rmSync(WORK, { recursive: true, force: true });
});

describe("a copied plugin works without host changes (US8, FR-020)", () => {
  it("builds with the SDK preset and renders next to the original", async () => {
    const pluginsDir = join(WORK, "plugins");
    const copy = join(pluginsDir, "copy");
    const source = join(ROOT, "plugins/reference");
    mkdirSync(copy, { recursive: true });
    for (const f of ["src", "package.json", "vite.config.ts"])
      cpSync(join(source, f), join(copy, f), { recursive: true });
    symlinkSync(join(source, "node_modules"), join(copy, "node_modules"), "dir");
    const pkg = JSON.parse(readFileSync(join(copy, "package.json"), "utf8"));
    pkg.name = "@acme/opsdash-copy";
    pkg.opsdash.id = "copy";
    writeFileSync(join(copy, "package.json"), JSON.stringify(pkg, null, 2));
    const client = join(copy, "src/client.tsx");
    writeFileSync(client, readFileSync(client, "utf8").replace("{item.refKey}</span>", "Copy of {item.refKey}</span>"));
    execFileSync(process.execPath, [join(source, "node_modules/vite/bin/vite.js"), "build", "--logLevel", "error"], {
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

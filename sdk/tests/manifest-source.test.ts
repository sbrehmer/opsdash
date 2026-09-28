import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readManifestSource } from "../src/vite.ts";

const fields = {
  id: "foo",
  apiVersion: "^1.1.0",
  server: "server.js",
  client: "client.js",
  capabilities: ["track"],
  env: ["FOO_TOKEN"],
  refresh: { interval: "60s", timeout: "10s" },
};

function pluginDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "opsdash-manifest-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(content));
  return dir;
}

describe("readManifestSource (003 contracts/plugin-manifest.md)", () => {
  it("reads plugin.json and package.json + opsdash to the same result", () => {
    const fromPlugin = readManifestSource(
      pluginDir({ "plugin.json": { name: "@acme/foo", version: "1.2.3", ...fields } }),
    );
    const fromPackage = readManifestSource(
      pluginDir({ "package.json": { name: "@acme/foo", version: "1.2.3", type: "module", opsdash: fields } }),
    );
    expect(fromPlugin).toEqual({ name: "@acme/foo", version: "1.2.3", fields });
    expect(fromPackage).toEqual(fromPlugin);
  });

  it("prefers plugin.json when both exist", () => {
    const dir = pluginDir({
      "plugin.json": { name: "@acme/foo", version: "2.0.0", ...fields },
      "package.json": { name: "@acme/other", version: "9.9.9", opsdash: { ...fields, id: "other" } },
    });
    expect(readManifestSource(dir)).toMatchObject({ name: "@acme/foo", version: "2.0.0", fields: { id: "foo" } });
  });

  it("refuses a folder without a manifest", () => {
    const dir = pluginDir({ "package.json": { name: "@acme/foo", version: "1.0.0" } });
    expect(() => readManifestSource(dir)).toThrow(
      `No plugin manifest: add plugin.json or an "opsdash" field in package.json (${dir})`,
    );
  });

  it("requires a version", () => {
    const dir = pluginDir({ "plugin.json": { name: "@acme/foo", ...fields } });
    expect(() => readManifestSource(dir)).toThrow(/missing "version"/);
  });
});

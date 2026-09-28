import { readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ROOT } from "./helpers.ts";

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const pkg = JSON.parse(read("package.json"));

function misePin(tool: string): string {
  // Keys may carry a backend prefix and quotes, e.g. `"npm:pnpm" = "10.33.0"`.
  const match = read("mise.toml").match(new RegExp(`^"?(?:[a-z]+:)?${tool}"?\\s*=\\s*"([^"]+)"`, "m"));
  if (!match) throw new Error(`mise.toml does not pin ${tool}`);
  return match[1];
}

describe("pinned toolchain (003 FR-003, FR-004)", () => {
  it("pins the same pnpm in mise.toml and packageManager", () => {
    expect(pkg.packageManager).toBe(`pnpm@${misePin("pnpm")}`);
  });

  it("pins a Node version that satisfies engines.node", () => {
    expect(semver.satisfies(misePin("node"), pkg.engines.node)).toBe(true);
  });

  it("makes the engine check strict and refuses other package managers", () => {
    expect(parse(read("pnpm-workspace.yaml")).engineStrict).toBe(true);
    expect(pkg.devEngines.packageManager).toMatchObject({ name: "pnpm", onFail: "error" });
  });
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import semver from "semver";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ROOT } from "./helpers.ts";

/** Directories that hold installs, build output, local data or other features' material. */
const SKIP = new Set(["node_modules", ".git", "dist", ".data", "specs", ".specify", ".claude", "test-results"]);

function findPackageJsons(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (relative(ROOT, path) === join("tests", ".tmp")) continue;
    if (statSync(path).isDirectory()) found.push(...findPackageJsons(path));
    else if (entry === "package.json") found.push(relative(ROOT, path));
  }
  return found;
}

const readJson = (file: string) => JSON.parse(readFileSync(join(ROOT, file), "utf8"));
const root = readJson("package.json");
const pluginIds = readdirSync(join(ROOT, "plugins")).filter((p) => statSync(join(ROOT, "plugins", p)).isDirectory());
const SDK_FIELDS = ["name", "version", "type", "description", "license", "exports", "files", "peerDependencies"];

describe("project layout (003 contracts/layout.md)", () => {
  it("has exactly one dependency declaration: the root package.json (FR-001, SC-002)", () => {
    const declaring = findPackageJsons(ROOT).filter((file) => {
      const pkg = readJson(file);
      return pkg.dependencies !== undefined || pkg.devDependencies !== undefined;
    });
    expect(declaring).toEqual(["package.json"]);
  });

  it("declares each package once (SC-003)", () => {
    const both = Object.keys(root.dependencies).filter((name) => name in root.devDependencies);
    expect(both).toEqual([]);
  });

  it("keeps sdk/package.json a publishing manifest whose peers the root install satisfies (FR-002)", () => {
    const sdk = readJson("sdk/package.json");
    expect(Object.keys(sdk).filter((key) => !SDK_FIELDS.includes(key))).toEqual([]);
    for (const [name, range] of Object.entries<string>(sdk.peerDependencies ?? {})) {
      const installed = readJson(join("node_modules", name, "package.json")).version;
      expect(semver.satisfies(installed, range), `${name}@${installed} satisfies ${range}`).toBe(true);
    }
  });

  it.each(pluginIds)("keeps plugins/%s to sources and plugin.json (FR-008, SC-005)", (id) => {
    const dir = join(ROOT, "plugins", id);
    expect(existsSync(join(dir, "plugin.json"))).toBe(true);
    const buildFiles = readdirSync(dir).filter(
      (f) => f === "package.json" || f === "tsconfig.json" || f === "node_modules" || f.startsWith("vite.config."),
    );
    expect(buildFiles).toEqual([]);
  });

  it("has no per-package workspace left", () => {
    expect(existsSync(join(ROOT, "packages"))).toBe(false);
    expect(parse(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")).packages).toBeUndefined();
  });
});

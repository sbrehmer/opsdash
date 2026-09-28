import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { configLocation, loadConfig } from "../../src/config/load.ts";
import { REPO } from "../helpers.ts";

describe("--config accepts a directory or a root file", () => {
  it("resolves a directory to its opsdash.yaml", () => {
    expect(configLocation(join(REPO, "examples/config"))).toEqual({
      dir: resolve(REPO, "examples/config"),
      rootFile: "opsdash.yaml",
    });
  });

  it("resolves a root file to its directory, so environments share includes", () => {
    const set = loadConfig(join(REPO, "config/production.yaml"));
    expect(set.dir).toBe(resolve(REPO, "config"));
    expect(set.errors).toEqual([]);
    expect(set.files).toEqual(["production.yaml", "dashboards/delivery.yaml"]);
    expect(set.dashboards.map((d) => d.id)).toEqual(["delivery"]);
  });

  it("loads every environment template without errors", () => {
    for (const env of ["mock", "development", "production"]) {
      expect(loadConfig(join(REPO, "config", `${env}.yaml`)).errors).toEqual([]);
    }
  });
});

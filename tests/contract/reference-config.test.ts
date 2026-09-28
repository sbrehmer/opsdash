import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, resolveDir } from "./helpers.ts";

describe("reference config contract (constitution quality gate)", () => {
  it("examples/config resolves with zero errors", async () => {
    const r = await resolveDir(join(ROOT, "examples/config"));
    expect(r.errors).toEqual([]);
    expect([...r.dashboards.keys()]).toEqual(["overview", "details", "team", "batching-demo", "delivery"]);
    for (const id of ["jira", "github", "jenkins", "delivery"]) {
      expect([...r.widgets.values()].some((w) => w.pluginId === id && w.status === "ok")).toBe(true);
    }
    expect([...r.widgets.values()].every((w) => w.status === "ok")).toBe(true);
  });

  it("resolved dashboards match the snapshot", async () => {
    const r = await resolveDir(join(ROOT, "examples/config"));
    const stable = JSON.parse(JSON.stringify([...r.dashboards.values()]).replace(/\?v=\d+/g, "?v=N"));
    expect(stable).toMatchSnapshot();
  });
});

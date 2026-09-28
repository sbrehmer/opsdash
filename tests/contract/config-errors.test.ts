import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeConfig } from "../../packages/host/tests/helpers.ts";
import { ROOT, resolveDir } from "./helpers.ts";

const FIXTURES = join(ROOT, "tests/fixtures/invalid-config");
const cases = readdirSync(FIXTURES);

describe("config error contract (US2, SC-002)", () => {
  it("has at least 20 invalid-config cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(cases)("%s: reports file, line, column, path and a plain message", async (name) => {
    const expected = JSON.parse(readFileSync(join(FIXTURES, name, "expected.json"), "utf8"));
    const { errors } = await resolveDir(join(FIXTURES, name));
    expect(errors.length).toBeGreaterThan(0);
    const [first] = errors;
    expect(first).toMatchObject({
      file: expected.file,
      line: expected.line,
      column: expected.column,
      path: expected.path,
    });
    expect(first!.message).toContain(expected.messageIncludes);
    expect(first!.message).toMatch(/[.!?]$/);
  });

  it("isolates errors: a valid dashboard resolves next to an invalid one (FR-009)", async () => {
    const dir = writeConfig({
      "opsdash.yaml": `version: 1
plugins:
  reference: { version: "^1.0.0" }
dashboards:
  - id: good
    title: Good
    items:
      - { id: a, plugin: reference, at: [1, 1], size: [6, 2] }
  - id: bad
    title: Bad
    items:
      - { id: a, plugin: reference, at: [9, 1], size: [6, 2] }
`,
    });
    const r = await resolveDir(dir);
    expect(r.dashboards.get("good")!.errors).toEqual([]);
    expect(r.dashboards.get("good")!.items).toHaveLength(1);
    expect(r.dashboards.get("bad")!.errors).toHaveLength(1);
    expect(r.dashboards.get("bad")!.items).toEqual([]);
  });
});

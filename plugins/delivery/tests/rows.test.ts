import { describe, expect, it } from "vitest";
import {
  buildRows,
  expired,
  groupRows,
  type Item,
  isDone,
  parseDuration,
  type Row,
  rank,
  sortRows,
  storyKeys,
} from "../src/rows.ts";

let nextId = 1;
const pr = (repo: string, number: number, data: Record<string, unknown> = {}): Item => ({
  plugin: "github",
  id: nextId++,
  refKey: `${repo}#${number}`,
  ref: { repo, number },
  data: {
    repo,
    number,
    url: `https://github.com/${repo}/pull/${number}`,
    title: `Change ${number}`,
    author: "ada",
    branch: `feature/${number}`,
    state: "open",
    review: null,
    checks: "success",
    updatedAt: "2026-09-01T00:00:00Z",
    mergedAt: null,
    closedAt: null,
    ...data,
  },
});
const job = (pipeline: string, name: string, build: Record<string, unknown> | null = {}): Item => ({
  plugin: "jenkins",
  id: nextId++,
  refKey: `${pipeline}/${name}`,
  ref: { pipeline, job: name },
  data: {
    pipeline,
    job: name,
    url: "",
    exists: true,
    build: build && {
      number: 1,
      url: "",
      result: "success",
      building: false,
      startedAt: 0,
      durationMs: 1,
      estimatedDurationMs: 1,
      ...build,
    },
    main: { branch: "main", lastSuccessAt: 1, url: null },
  },
});
const story = (key: string): Item => ({ plugin: "jira", id: nextId++, refKey: key, ref: { key } });

const row = (p: Item, j?: Item): Row => buildRows(j ? [p, j] : [p], j ? [{ from: p.id!, to: j.id! }] : [])[0]!;

describe("buildRows", () => {
  it("keys rows by the github reference and attaches linked job and story", () => {
    const p1 = pr("acme/web", 1);
    const p2 = pr("acme/web", 2);
    const j1 = job("acme/web", "PR-1");
    const s = story("PROJ-1");
    const rows = buildRows(
      [s, j1, p1, p2],
      [
        { from: p1.id!, to: j1.id! },
        { from: p1.id!, to: s.id! },
        { from: p2.id!, to: s.id! },
      ],
    );
    expect(rows.map((r) => r.pr.refKey)).toEqual(["acme/web#1", "acme/web#2"]);
    expect(rows[0]!.job?.refKey).toBe("acme/web/PR-1");
    expect(rows[0]!.story?.refKey).toBe("PROJ-1");
    expect(rows[1]!.job).toBeUndefined();
    expect(rows[1]!.story?.refKey).toBe("PROJ-1");
  });
});

describe("attention ordering", () => {
  it("ranks failures, requested changes and failing checks first, then running builds", () => {
    expect(rank(row(pr("a/b", 1), job("b", "PR-1", { result: "failure" })))).toBe(0);
    expect(rank(row(pr("a/b", 1), job("b", "PR-1", { result: "unstable" })))).toBe(0);
    expect(rank(row(pr("a/b", 1, { review: "changes_requested" }), job("b", "PR-1")))).toBe(0);
    expect(rank(row(pr("a/b", 1, { checks: "failure" }), job("b", "PR-1")))).toBe(0);
    expect(rank(row(pr("a/b", 1, { checks: "error" }), job("b", "PR-1")))).toBe(0);
    expect(rank(row(pr("a/b", 1), job("b", "PR-1", { building: true, result: null })))).toBe(1);
    expect(rank(row(pr("a/b", 1), job("b", "PR-1")))).toBe(2);
    expect(rank(row(pr("a/b", 1), job("b", "PR-1", null)))).toBe(2);
    expect(rank(row(pr("a/b", 1)))).toBe(2);
  });

  it("sorts rows by rank, then by most recent activity", () => {
    const old = row(pr("a/b", 1, { updatedAt: "2026-01-01T00:00:00Z" }));
    const recent = row(pr("a/b", 2, { updatedAt: "2026-09-01T00:00:00Z" }));
    const building = row(pr("a/b", 3), job("b", "PR-3", { building: true }));
    const failed = row(pr("a/b", 4, { updatedAt: "2025-01-01T00:00:00Z" }), job("b", "PR-4", { result: "failure" }));
    const byBuild = row(
      pr("a/b", 5, { updatedAt: "2025-01-01T00:00:00Z" }),
      job("b", "PR-5", { startedAt: Date.parse("2026-10-01T00:00:00Z") }),
    );
    expect(sortRows([old, recent, building, failed, byBuild]).map((r) => r.pr.refKey)).toEqual([
      "a/b#4",
      "a/b#3",
      "a/b#5",
      "a/b#2",
      "a/b#1",
    ]);
  });
});

describe("groupRows", () => {
  it("groups by repository, groups sorted by lowest rank then name", () => {
    const rows = [
      row(pr("acme/zeta", 1)),
      row(pr("acme/api", 2)),
      row(pr("acme/web", 3)),
      row(pr("acme/web", 4), job("web", "PR-4", { result: "failure" })),
      row(pr("acme/api", 5), job("api", "PR-5", { building: true })),
    ];
    const groups = groupRows(rows);
    expect(groups.map((g) => [g.repo, g.rank])).toEqual([
      ["acme/web", 0],
      ["acme/api", 1],
      ["acme/zeta", 2],
    ]);
    expect(groups[0]!.rows.map((r) => r.pr.refKey)).toEqual(["acme/web#4", "acme/web#3"]);
    expect(groups[1]!.rows.map((r) => r.pr.refKey)).toEqual(["acme/api#5", "acme/api#2"]);
  });

  it("falls back to the reference's repository when the PR has no data", () => {
    const p = { ...pr("acme/web", 9), data: undefined, error: "boom" };
    expect(groupRows([row(p)]).map((g) => g.repo)).toEqual(["acme/web"]);
  });
});

describe("done and retention", () => {
  const now = Date.parse("2026-09-28T00:00:00Z");
  const week = parseDuration("7d");

  it("classifies merged and closed PRs as done", () => {
    expect(isDone(row(pr("a/b", 1, { state: "merged" })))).toBe(true);
    expect(isDone(row(pr("a/b", 1, { state: "closed" })))).toBe(true);
    expect(isDone(row(pr("a/b", 1, { state: "open" })))).toBe(false);
    expect(isDone(row(pr("a/b", 1, { state: "draft" })))).toBe(false);
    expect(isDone(row({ ...pr("a/b", 1), data: undefined }))).toBe(false);
  });

  it("expires done rows older than the retention, by mergedAt then closedAt", () => {
    const merged8 = row(
      pr("a/b", 1, { state: "merged", mergedAt: "2026-09-20T00:00:00Z", closedAt: "2026-09-27T00:00:00Z" }),
    );
    const merged6 = row(pr("a/b", 2, { state: "merged", mergedAt: "2026-09-22T00:00:00Z" }));
    const closed8 = row(pr("a/b", 3, { state: "closed", closedAt: "2026-09-20T00:00:00Z" }));
    const open = row(pr("a/b", 4, { state: "open", closedAt: "2026-09-01T00:00:00Z" }));
    expect(expired(merged8, week, now)).toBe(true);
    expect(expired(merged6, week, now)).toBe(false);
    expect(expired(closed8, week, now)).toBe(true);
    expect(expired(open, week, now)).toBe(false);
  });

  it("parses durations", () => {
    expect(parseDuration("250ms")).toBe(250);
    expect(parseDuration("10s")).toBe(10_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(week).toBe(604_800_000);
    expect(() => parseDuration("7 days")).toThrow();
  });
});

describe("storyKeys", () => {
  it("takes keys from the title before the branch, without duplicates", () => {
    expect(storyKeys("PROJ-65: fix login (see OPS-2)", "feature/PROJ-65-login-OPS-3")).toEqual([
      "PROJ-65",
      "OPS-2",
      "OPS-3",
    ]);
    expect(storyKeys("Fix login", "feature/PROJ-7-login")).toEqual(["PROJ-7"]);
    expect(storyKeys("Fix login", "main")).toEqual([]);
    expect(storyKeys(undefined, undefined)).toEqual([]);
  });

  it("filters by project keys when given", () => {
    expect(storyKeys("OPS-2 and PROJ-65", "feature/AB_C-9", ["PROJ", "AB_C"])).toEqual(["PROJ-65", "AB_C-9"]);
    expect(storyKeys("OPS-2 and PROJ-65", "", [])).toEqual(["OPS-2", "PROJ-65"]);
  });
});

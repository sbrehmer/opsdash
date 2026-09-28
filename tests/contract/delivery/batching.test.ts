import { MOCK_REQUESTS_KEY } from "@opsdash/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { copyExamples, type Harness, type SseClient, sse, start } from "../../../tests/server/helpers.ts";

const TRACKER = "delivery/tracker";
const SOURCES = ["jira", "github", "jenkins"] as const;
const REPOS = ["web", "api", "mobile"];

let h: Harness | undefined;
const viewers: SseClient[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) v.close();
  await h?.close();
  h = undefined;
});

const post = (path: string, body: unknown) =>
  fetch(`${h!.ops.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const requests = () =>
  Object.fromEntries(
    SOURCES.map((id) => [id, (h!.ops.repos.stateGet(id, MOCK_REQUESTS_KEY) as number | undefined) ?? 0]),
  ) as Record<(typeof SOURCES)[number], number>;
const lastCycle = (plugin: string) =>
  h!.logs
    .events("refresh.cycle")
    .filter((l) => l.plugin === plugin)
    .at(-1);

/** 30 rows over 3 repositories (and so 3 Jenkins pipelines); two thirds carry a story, one third starts from a job. */
async function seed() {
  for (let i = 0; i < 30; i++) {
    const repo = REPOS[i % 3];
    const n = 1500 + i;
    const payload =
      i % 3 === 1 ? { job: `acme/${repo}/PR-${n}` } : { pr: `acme/${repo}#${n}`, story: `PROJ-${n % 97}` };
    const res = await post(`/api/widgets/${encodeURIComponent(TRACKER)}/actions/addRow`, payload);
    expect(res.status, JSON.stringify(payload)).toBe(200);
  }
  await h!.ops.scheduler.idle();
}

/** One full refresh cycle for every source plugin, outside the cache window; returns the requests it made. */
async function cycle() {
  const before = requests();
  h!.ops.scheduler.cache.clear();
  for (const id of SOURCES) await h!.ops.scheduler.tick(id);
  await h!.ops.scheduler.idle();
  const after = requests();
  return Object.fromEntries(SOURCES.map((id) => [id, after[id] - before[id]]));
}

describe("delivery tracker batching (US3, SC-004)", () => {
  it("makes 1 Jira, 1 GitHub and 3 Jenkins requests per cycle for 30 rows, with one or three viewers", async () => {
    h = await start({ configDir: copyExamples() });
    viewers.push(await sse(h.ops.url, "delivery"));
    await seed();

    const rows = h.ops.repos.listRefs(TRACKER);
    expect(rows.filter((r) => r.pluginId === "github")).toHaveLength(30);
    expect(rows.filter((r) => r.pluginId === "jenkins")).toHaveLength(30);
    const stories = new Set(rows.filter((r) => r.pluginId === "jira").map((r) => r.refKey)).size;
    expect(stories).toBe(20);

    const expected = { jira: 1, github: 1, jenkins: 3 };
    expect(await cycle()).toEqual(expected);
    expect(lastCycle("jira")).toMatchObject({ requests: 1, refs: stories, failures: 0 });
    expect(lastCycle("github")).toMatchObject({ requests: 1, refs: 30, failures: 0 });
    expect(lastCycle("jenkins")).toMatchObject({ requests: 3, refs: 30, failures: 0 });

    // More viewers of the same dashboard add no requests.
    viewers.push(await sse(h.ops.url, "delivery"), await sse(h.ops.url, "delivery"));
    await h.ops.scheduler.idle();
    expect(await cycle()).toEqual(expected);
    expect(lastCycle("github")).toMatchObject({ requests: 1, refs: 30 });
    expect(lastCycle("jenkins")).toMatchObject({ requests: 3, refs: 30 });

    const data = h.ops.scheduler.latest(TRACKER)!;
    expect(data.items).toHaveLength(80);
    expect(data.items.every((i) => i.data !== undefined)).toBe(true);
  });

  it("requests a pull request tracked in both the tracker and the standalone GitHub widget once", async () => {
    h = await start({ configDir: copyExamples() });
    viewers.push(await sse(h.ops.url, "delivery"));
    await post(`/api/widgets/${encodeURIComponent(TRACKER)}/actions/addRow`, { pr: "acme/web#1500" });
    const res = await post(`/api/widgets/${encodeURIComponent("delivery/prs")}/items`, { input: "acme/web#1500" });
    expect(res.status).toBeLessThan(300);
    await h.ops.scheduler.idle();

    expect((await cycle()).github).toBe(1);
    expect(lastCycle("github")).toMatchObject({ requests: 1, refs: 1, widgets: 2 });
    const standalone = h.ops.scheduler.latest("delivery/prs")!;
    const tracker = h.ops.scheduler.latest(TRACKER)!;
    const inTracker = tracker.items.find((i) => i.plugin === "github")!;
    expect(standalone.items.map((i) => i.refKey)).toEqual(["acme/web#1500"]);
    expect(standalone.items[0]!.data).toEqual(inTracker.data);
  });
});

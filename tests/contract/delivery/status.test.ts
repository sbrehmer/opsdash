import { afterEach, describe, expect, it } from "vitest";
import { type Harness, type SseClient, sse, start, writeConfig } from "../../../packages/host/tests/helpers.ts";

const PATH = "d/tracker";
let h: Harness | undefined;
let viewer: SseClient | undefined;
afterEach(async () => {
  viewer?.close();
  viewer = undefined;
  await h?.close();
  h = undefined;
});

interface Options {
  github?: string;
  jenkins?: string;
  jenkinsExtra?: string;
}

const config = (o: Options) => `version: 1
plugins:
  jira:
    version: "^1.0.0"
    settings: { deployment: cloud, baseUrl: "https://jira.example.com", email: "me@example.com", token: { env: JIRA_TOKEN } }
  github:
    version: "^1.0.0"
    settings: { token: { env: GITHUB_TOKEN } }
    mock: ${o.github ?? "{}"}
  jenkins:
    version: "^1.0.0"
    settings:
      baseUrl: "https://ci.example.com"
      user: bot
      token: { env: JENKINS_TOKEN }
      pipelineTemplate: "{owner}/{name}"
      runningRefreshInterval: 200ms
    mock: ${o.jenkins ?? "{}"}
${o.jenkinsExtra ?? ""}
  delivery:
    version: "^1.0.0"
dashboards:
  - id: d
    title: Delivery
    items:
      - id: tracker
        plugin: delivery
        at: [1, 1]
        size: [12, 6]
        settings: { retention: 7d }
`;

async function boot(o: Options, timers = false) {
  h = await start({
    configDir: writeConfig({ "opsdash.yaml": config(o) }),
    processEnv: { JIRA_TOKEN: "j", GITHUB_TOKEN: "g", JENKINS_TOKEN: "k" },
    timers,
  });
  // Refreshes run only for dashboards with a viewer.
  viewer = await sse(h.ops.url, "d");
  return h;
}

async function addRow(payload: Record<string, string>) {
  const res = await fetch(`${h!.ops.url}/api/widgets/${encodeURIComponent(PATH)}/actions/addRow`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(200);
}

const jenkinsCycles = () => h!.logs.events("refresh.cycle").filter((l) => l.plugin === "jenkins");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("Timed out");
    await sleep(25);
  }
}

describe("delivery tracker status (US2)", () => {
  // A `scheduleNext` run must fetch again even inside the cache window (default 30 s, longer than the 10 s
  // running interval); otherwise the follow-up run is served from cache and the fast refresh stops.
  it("refreshes Jenkins at the running interval while a build runs", async () => {
    await boot({ jenkins: `{ scenario: { running: ["acme/web/PR-1"] } }` }, true);
    await addRow({ pr: "acme/web#1" });
    const startedAt = Date.now();
    await until(() => jenkinsCycles().filter((l) => l.refs === 1).length >= 3, 5000);
    // Three runs (the action's, then two scheduled ones) well within one default interval (60 s).
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(jenkinsCycles().filter((l) => l.refs === 1)[0]!.nextInMs).toBe(200);
    const job = (h!.ops.scheduler.latest(PATH) as any).items.find((i: any) => i.plugin === "jenkins");
    expect(job.data.build.building).toBe(true);
  });

  it("returns to the normal interval when nothing is running", async () => {
    await boot({ jenkins: `{ scenario: { failed: ["acme/web/PR-1"] } }` }, true);
    await addRow({ pr: "acme/web#1" });
    await until(() => jenkinsCycles().some((l) => l.refs === 1), 5000);
    await h!.ops.scheduler.idle();
    const withRefs = () => jenkinsCycles().filter((l) => l.refs === 1);
    expect(withRefs()[0]!.nextInMs).toBeUndefined();
    await sleep(800);
    expect(withRefs()).toHaveLength(1);
  });

  it("removes rows merged longer ago than the retention", async () => {
    await boot({ github: `{ scenario: { mergedAgoDays: { "acme/web#77": 8, "acme/web#78": 2 } } }` });
    await addRow({ pr: "acme/web#77", story: "PROJ-77" });
    await addRow({ pr: "acme/web#78" });
    await addRow({ pr: "acme/web#79" });
    await h!.ops.scheduler.idle();

    const keys = h!.ops.repos
      .listRefs(PATH)
      .map((r) => r.refKey)
      .sort();
    expect(keys).toEqual(["acme/web#78", "acme/web#79", "acme/web/PR-78", "acme/web/PR-79"]);
    expect(h!.logs.events("delivery.row.expired")).toEqual([
      expect.objectContaining({ plugin: "delivery", path: PATH, pr: "acme/web#77" }),
    ]);
    const data = h!.ops.scheduler.latest(PATH) as any;
    expect(data.items.map((i: any) => i.refKey).sort()).toEqual(keys);
    // The done row (merged 2 days ago) stays.
    expect(data.items.find((i: any) => i.refKey === "acme/web#78").data.state).toBe("merged");
  });

  it("isolates a slow Jenkins: its items time out while GitHub and Jira stay fresh", async () => {
    await boot({ jenkins: "{ latencyMs: 20000 }", jenkinsExtra: "    timeout: 1s" });
    await addRow({ pr: "acme/web#1", story: "PROJ-1" });
    await h!.ops.scheduler.idle();
    const items = (h!.ops.scheduler.latest(PATH) as any).items as Array<{ plugin: string; state: string }>;
    const state = (plugin: string) => items.find((i) => i.plugin === plugin)!.state;
    expect(["timeout", "stale"]).toContain(state("jenkins"));
    expect(state("github")).toBe("ok");
    expect(state("jira")).toBe("ok");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { type Harness, type SseClient, sse, start, writeConfig } from "../../../tests/server/helpers.ts";

const PATH = "d/tracker";
let h: Harness | undefined;
let viewer: SseClient | undefined;
afterEach(async () => {
  viewer?.close();
  viewer = undefined;
  await h?.close();
  h = undefined;
});

const config = (scenario = "{}") => `version: 1
plugins:
  jira:
    version: "^1.0.0"
    settings: { deployment: cloud, baseUrl: "https://jira.example.com", email: "me@example.com", token: { env: JIRA_TOKEN } }
  github:
    version: "^1.0.0"
    settings: { token: { env: GITHUB_TOKEN } }
  jenkins:
    version: "^1.0.0"
    settings: { baseUrl: "https://ci.example.com", user: bot, token: { env: JENKINS_TOKEN }, pipelineTemplate: "{owner}/{name}" }
    mock: { scenario: ${scenario} }
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

async function boot(scenario?: string) {
  h = await start({
    configDir: writeConfig({ "opsdash.yaml": config(scenario) }),
    processEnv: { JIRA_TOKEN: "j", GITHUB_TOKEN: "g", JENKINS_TOKEN: "k" },
  });
  // Refreshes run only for dashboards with a viewer.
  viewer = await sse(h.ops.url, "d");
  return viewer;
}

async function run(name: string, payload: unknown) {
  const res = await fetch(`${h!.ops.url}/api/widgets/${encodeURIComponent(PATH)}/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as { ok?: true; error?: string } };
}

/** The widget's stored rows as `prKey → { job, story }`. */
function rows() {
  const refs = h!.ops.repos.listRefs(PATH);
  const byId = new Map(refs.map((r) => [r.id, r]));
  const links = h!.ops.repos.listLinksForWidget(PATH);
  const out: Record<string, { jobs: string[]; stories: string[] }> = {};
  for (const pr of refs.filter((r) => r.pluginId === "github")) {
    const targets = links.filter((l) => l.from === pr.id).map((l) => byId.get(l.to)!);
    out[pr.refKey] = {
      jobs: targets.filter((t) => t.pluginId === "jenkins").map((t) => t.refKey),
      stories: targets.filter((t) => t.pluginId === "jira").map((t) => t.refKey),
    };
  }
  return out;
}
const keys = (plugin: string) =>
  h!.ops.repos
    .listRefs(PATH)
    .filter((r) => r.pluginId === plugin)
    .map((r) => r.refKey)
    .sort();
const latest = () => h!.ops.scheduler.latest(PATH) as any;

describe("delivery tracker actions (US1)", () => {
  it("publishes an empty tracker, then adds a row from a pull request with the job inferred", async () => {
    const s = await boot();
    const snap = s.events.find((e) => e.event === "snapshot")!.data.widgets.find((w: any) => w.path === PATH);
    expect(snap.state).toBe("empty");
    expect(snap.items).toEqual([]);

    expect(await run("addRow", { pr: "acme/web#1423" })).toEqual({ status: 200, body: { ok: true } });
    expect(rows()).toEqual({ "acme/web#1423": { jobs: ["acme/web/PR-1423"], stories: [] } });

    // Published right after the action (H2), then with data once the owning plugins have run (H3).
    const first = await s.waitFor(
      (e) => e.event === "widget-data" && e.data.path === PATH && e.data.items.length === 2,
    );
    expect(first.data.items.map((i: any) => i.plugin).sort()).toEqual(["github", "jenkins"]);
    expect(first.data.links).toHaveLength(1);
    await h!.ops.scheduler.idle();
    const data = latest();
    expect(data.items.every((i: any) => i.data !== undefined)).toBe(true);
    const pr = data.items.find((i: any) => i.plugin === "github");
    expect(pr.data.title).toMatch(/^PROJ-65: /);
    expect((data.meta as { dismissed: unknown }).dismissed).toEqual({});
  });

  it("infers the pull request from a job, and rejects mismatches, duplicates and unknown pipelines", async () => {
    await boot(`{ unknownPipelines: ["acme/legacy"] }`);
    expect((await run("addRow", { job: "acme/api/PR-7" })).status).toBe(200);
    expect(rows()).toEqual({ "acme/api#7": { jobs: ["acme/api/PR-7"], stories: [] } });

    const mismatch = await run("addRow", { pr: "acme/web#1", job: "acme/web/PR-2" });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error).toMatch(/builds a different pull request/);

    const dup = await run("addRow", { pr: "acme/api#7" });
    expect(dup.status).toBe(422);
    expect(dup.body.error).toMatch(/already tracked/);

    const unknown = await run("addRow", { pr: "acme/legacy#3" });
    expect(unknown.status).toBe(422);
    expect(unknown.body.error).toMatch(/No Jenkins pipeline/);

    const empty = await run("addRow", {});
    expect(empty.status).toBe(422);
    const bad = await run("addRow", { pr: "not a pr" });
    expect(bad.status).toBe(422);
    expect(Object.keys(rows())).toEqual(["acme/api#7"]);
  });

  it("adds a row whose job does not exist yet (pending)", async () => {
    await boot(`{ noJob: ["acme/web/PR-5"] }`);
    expect((await run("addRow", { pr: "acme/web#5", story: "PROJ-5" })).status).toBe(200);
    expect(rows()).toEqual({ "acme/web#5": { jobs: ["acme/web/PR-5"], stories: ["PROJ-5"] } });
    await h!.ops.scheduler.idle();
    const job = latest().items.find((i: any) => i.plugin === "jenkins");
    expect(job.data).toMatchObject({ exists: false, build: null });
  });

  it("sets and removes stories, keeping a story still linked to another row", async () => {
    await boot();
    await run("addRow", { pr: "acme/web#1", story: "PROJ-1" });
    await run("addRow", { pr: "acme/web#2", story: "PROJ-1" });

    expect((await run("setStory", { pr: "acme/web#1", story: "PROJ-9" })).status).toBe(200);
    expect(rows()["acme/web#1"]!.stories).toEqual(["PROJ-9"]);
    expect(keys("jira")).toEqual(["PROJ-1", "PROJ-9"]); // PROJ-1 is still linked to #2

    expect((await run("setStory", { pr: "acme/web#2", story: "PROJ-3" })).status).toBe(200);
    expect(keys("jira")).toEqual(["PROJ-3", "PROJ-9"]); // PROJ-1 lost its last link

    expect((await run("setStory", { pr: "acme/web#2", story: "PROJ-9" })).status).toBe(200);
    expect((await run("removeStory", { pr: "acme/web#1" })).status).toBe(200);
    expect(rows()["acme/web#1"]!.stories).toEqual([]);
    expect(keys("jira")).toEqual(["PROJ-9"]);
    expect((await run("removeStory", { pr: "acme/web#2" })).status).toBe(200);
    expect(keys("jira")).toEqual([]);

    const notTracked = await run("setStory", { pr: "acme/web#99", story: "PROJ-1" });
    expect(notTracked.status).toBe(422);
    expect(notTracked.body.error).toMatch(/not tracked/);
    expect((await run("setStory", { pr: "acme/web#1", story: "nope" })).status).toBe(422);
  });

  it("keeps exactly one job per row with reinferJob and setJob", async () => {
    await boot();
    await run("addRow", { pr: "acme/web#10", job: "acme/web/PR-10" });

    const wrong = await run("setJob", { pr: "acme/web#10", job: "acme/web/PR-11" });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error).toMatch(/builds a different pull request/);
    expect((await run("setJob", { pr: "acme/web#10", job: "acme/web/PR-10" })).status).toBe(200);
    expect(rows()["acme/web#10"]!.jobs).toEqual(["acme/web/PR-10"]);

    // A stale job link (e.g. from before a pipeline rename) is replaced by re-inference.
    const refs = h!.ops.repos.listRefs(PATH);
    const pr = refs.find((r) => r.pluginId === "github")!;
    const job = refs.find((r) => r.pluginId === "jenkins")!;
    h!.ops.repos.removeLink(pr.id, job.id);
    const old = h!.ops.repos.trackRef(PATH, "jenkins", "old/web/PR-10", { pipeline: "old/web", job: "PR-10" });
    h!.ops.repos.createLink(pr.id, old.id, "delivery");
    h!.ops.repos.removeRef(job.id, false);
    expect(rows()["acme/web#10"]!.jobs).toEqual(["old/web/PR-10"]);

    expect((await run("reinferJob", { pr: "acme/web#10" })).status).toBe(200);
    expect(rows()["acme/web#10"]!.jobs).toEqual(["acme/web/PR-10"]);
    expect(keys("jenkins")).toEqual(["acme/web/PR-10"]);
  });

  it("links and dismisses suggestions, and removes rows with cascade", async () => {
    await boot();
    await run("addRow", { pr: "acme/web#1423" });
    await run("addRow", { pr: "acme/web#1424", story: "PROJ-1" });
    await run("addRow", { pr: "acme/web#1425", story: "PROJ-1" });

    expect((await run("dismissSuggestion", { pr: "acme/web#1424", story: "PROJ-66" })).status).toBe(200);
    expect((await run("dismissSuggestion", { pr: "acme/web#1424", story: "PROJ-66" })).status).toBe(200);
    expect((latest().meta as { dismissed: unknown }).dismissed).toEqual({ "acme/web#1424": ["PROJ-66"] });

    expect((await run("linkSuggestion", { pr: "acme/web#1423", story: "PROJ-65" })).status).toBe(200);
    expect(rows()["acme/web#1423"]!.stories).toEqual(["PROJ-65"]);

    expect((await run("removeRow", { pr: "acme/web#1424" })).status).toBe(200);
    expect(Object.keys(rows()).sort()).toEqual(["acme/web#1423", "acme/web#1425"]);
    expect(keys("jenkins")).toEqual(["acme/web/PR-1423", "acme/web/PR-1425"]);
    expect(keys("jira")).toEqual(["PROJ-1", "PROJ-65"]); // PROJ-1 is still linked to #1425
    expect((latest().meta as { dismissed: unknown }).dismissed).toEqual({});
    expect(h!.ops.scheduler.contextDeps.repos.stateList("delivery")).toEqual([]);

    expect((await run("removeRow", { pr: "acme/web#1425" })).status).toBe(200);
    expect(keys("jira")).toEqual(["PROJ-65"]);
    expect((await run("removeRow", { pr: "acme/web#1425" })).status).toBe(422);
  });

  it("cleans up dismissals of rows removed outside removeRow", async () => {
    await boot();
    await run("addRow", { pr: "acme/web#1" });
    await run("dismissSuggestion", { pr: "acme/web#1", story: "PROJ-1" });
    const pr = h!.ops.repos.listRefs(PATH).find((r) => r.pluginId === "github")!;
    h!.ops.repos.removeRef(pr.id, true);
    await h!.ops.scheduler.refreshComposite(PATH);
    expect(h!.ops.scheduler.contextDeps.repos.stateList("delivery")).toEqual([]);
  });

  it("rejects unknown actions", async () => {
    await boot();
    expect((await run("nope", {})).status).toBe(404);
  });
});

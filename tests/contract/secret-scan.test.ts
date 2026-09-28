import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyExamples, sse, start } from "../../packages/host/tests/helpers.ts";
import { startFakeGithub } from "./delivery/fakes/github.ts";

const SECRET = "s3cr3t-value-for-scan";

function scanDir(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => {
    try {
      return readFileSync(join(dir, f)).includes(SECRET);
    } catch {
      return false;
    }
  });
}

describe("secret scan (US7, SC-009)", () => {
  it("never writes or sends a secret value anywhere", async () => {
    const configDir = copyExamples();
    const h = await start({ configDir, mock: false, processEnv: { REFERENCE_TOKEN: SECRET } });
    const captured: string[] = [];
    const get = async (path: string, init?: RequestInit) => {
      const res = await fetch(`${h.ops.url}${path}`, init);
      captured.push(await res.text());
    };
    const events = await sse(h.ops.url, "overview");
    await h.ops.scheduler.idle();
    // LEAK-1 makes the reference source throw an error containing the token.
    await get(`/api/widgets/${encodeURIComponent("overview/watchlist")}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "LEAK-1" }),
    });
    await h.ops.scheduler.idle();
    await events.waitFor((e) => e.event === "widget-data" && e.data.path === "overview/watchlist" && e.data.error);
    for (const path of ["/api/dashboards", "/api/dashboards/overview", "/api/status", "/healthz", "/api/meta"])
      await get(path);
    captured.push(JSON.stringify(events.events));
    events.close();
    const dbFile = h.ops.store.file;
    await h.close();

    expect(h.logs.raw).toContain("[REDACTED]"); // the leak was attempted and caught
    expect(h.logs.raw).not.toContain(SECRET);
    for (const body of captured) expect(body).not.toContain(SECRET);
    expect(readFileSync(dbFile).includes(SECRET)).toBe(false);
    expect(scanDir(join(dbFile, ".."))).toEqual([]);
    expect(scanDir(configDir)).toEqual([]);
  });

  it("reports a missing secret by plugin and variable, and health is degraded", async () => {
    const h = await start({ configDir: copyExamples(), mock: false, processEnv: {} });
    const status = await (await fetch(`${h.ops.url}/api/status`)).json();
    const reference = status.plugins.find((p: { id: string }) => p.id === "reference");
    expect(reference.issues).toEqual(["REFERENCE_TOKEN missing for plugin reference"]);
    const events = await sse(h.ops.url, "overview");
    await h.ops.scheduler.idle();
    expect(h.ops.scheduler.latest("overview/open-items")).toMatchObject({
      state: "error",
      error: "REFERENCE_TOKEN missing for plugin reference",
    });
    expect((await (await fetch(`${h.ops.url}/healthz`)).json()).status).toBe("degraded");
    events.close();
    await h.close();
  });

  it("lists each delivery plugin's missing token while GitHub keeps working (US5 scenario 3)", async () => {
    const fake = await startFakeGithub({ "acme/web#12": { title: "PROJ-12: From the fake" } });
    const configDir = copyExamples();
    const file = join(configDir, "opsdash.yaml");
    writeFileSync(file, readFileSync(file, "utf8").replace("https://api.github.com/graphql", `${fake.url}/graphql`));
    const h = await start({ configDir, mock: false, processEnv: { GITHUB_TOKEN: "ghp_onlyThisOne" } });
    try {
      const status = await (await fetch(`${h.ops.url}/api/status`)).json();
      const issues = (id: string) => status.plugins.find((p: { id: string }) => p.id === id).issues;
      expect(issues("jira")).toEqual(["JIRA_TOKEN missing for plugin jira"]);
      expect(issues("jenkins")).toEqual(["JENKINS_TOKEN missing for plugin jenkins"]);
      expect(issues("github")).toEqual([]);
      expect(JSON.stringify(status)).toContain("JIRA_TOKEN missing for plugin jira");

      const events = await sse(h.ops.url, "delivery");
      const res = await fetch(`${h.ops.url}/api/widgets/${encodeURIComponent("delivery/prs")}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "acme/web#12" }),
      });
      expect(res.status).toBeLessThan(300);
      await h.ops.scheduler.idle();
      const prs = h.ops.scheduler.latest("delivery/prs")!;
      expect(prs.state).toBe("ok");
      expect(prs.items[0]!.data).toMatchObject({ title: "PROJ-12: From the fake" });
      expect(fake.requests.length).toBeGreaterThan(0);
      events.close();
    } finally {
      await h.close();
      await fake.close();
    }
  });

  it("needs no secrets in mock mode", async () => {
    const h = await start({ configDir: copyExamples(), mock: true, processEnv: {} });
    expect((await (await fetch(`${h.ops.url}/healthz`)).json()).status).toBe("healthy");
    await h.close();
  });
});

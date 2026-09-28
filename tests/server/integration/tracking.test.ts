import { afterEach, describe, expect, it } from "vitest";
import { createContext } from "../../../src/server/plugins/context.ts";
import { copyExamples, type Harness, sse, start } from "../helpers.ts";

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const url = (path: string) => `${h!.ops.url}/api/widgets/${encodeURIComponent(path)}/items`;
const track = (path: string, input: string) =>
  fetch(url(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input }),
  });

describe("tracking items per widget (US6)", () => {
  it("tracks, rejects duplicates and invalid input, untracks, and refreshes the widget", async () => {
    h = await start({ configDir: copyExamples() });
    const s = await sse(h.ops.url, "overview");
    await h.ops.scheduler.idle();

    const created = await track("overview/watchlist", "ITEM-7");
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ refKey: "ITEM-7", ref: { key: "ITEM-7" } });
    await s.waitFor(
      (e) => e.event === "widget-data" && e.data.path === "overview/watchlist" && e.data.items.length === 1,
    );

    expect((await track("overview/watchlist", "ITEM-7")).status).toBe(409);
    const bad = await track("overview/watchlist", "bad");
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatch(/ITEM-123/);
    const notFound = await track("overview/watchlist", "ITEM-404");
    expect(notFound.status).toBe(422);
    expect((await notFound.json()).error).toMatch(/not found/);
    expect((await track("nope/widget", "ITEM-1")).status).toBe(404);

    expect(await (await fetch(url("overview/watchlist"))).json()).toEqual([
      { plugin: "reference", id: expect.any(Number), refKey: "ITEM-7", ref: { key: "ITEM-7" } },
    ]);
    expect((await fetch(`${url("overview/watchlist")}/ITEM-7`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${url("overview/watchlist")}/ITEM-7`, { method: "DELETE" })).status).toBe(404);
    s.close();
  });

  it("keeps separate lists per block use and per widget", async () => {
    h = await start({ configDir: copyExamples() });
    expect((await track("team/team-b/items", "ITEM-9")).status).toBe(201);
    expect(h.ops.repos.listRefs("team/team-b/items")).toHaveLength(1);
    expect(h.ops.repos.listRefs("team/team-c/items")).toHaveLength(0);
    expect(h.ops.repos.listRefs("overview/team-a/items")).toHaveLength(0);
    // The same item may be tracked in another widget.
    expect((await track("overview/watchlist", "ITEM-9")).status).toBe(201);
  });

  it("isolates plugin state, allows cross-plugin ref lookups, and stores identifiers only", async () => {
    h = await start({ configDir: copyExamples() });
    await track("overview/watchlist", "ITEM-5");
    const deps = h.ops.scheduler.contextDeps;
    const a = createContext(deps, "reference", { settings: {}, timeoutMs: 1000, allowedEnv: [] });
    const b = createContext(deps, "other", { settings: {}, timeoutMs: 1000, allowedEnv: [] });
    a.state.set("secret-ish", 1);
    expect(b.state.get("secret-ish")).toBeUndefined();
    expect(b.state.list()).toEqual([]);
    expect(b.refs.find("reference", "ITEM-5")).toHaveLength(1);
    expect(() => a.secrets.get("NOT_DECLARED")).toThrow(/did not declare/);

    const rows = h.ops.store.sqlite.prepare("select * from tracked_ref").all() as Array<Record<string, unknown>>;
    expect(Object.keys(rows[0]!).sort()).toEqual(["created_at", "id", "plugin_id", "ref", "ref_key", "widget_path"]);
    expect(JSON.parse(rows[0]!.ref as string)).toEqual({ key: "ITEM-5" });
  });
});

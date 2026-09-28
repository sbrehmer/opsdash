import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tiny plugin API 1.1 fixtures (T006), written by hand as plain ESM without imports so they need no build:
 * `src1` is a source plugin with a resolver, `comp` a composite plugin composing `src1` with actions and `onData`.
 * The plugins record what they do in `globalThis.__api11` (see `Api11Probe`), shared with the test process.
 */
export interface Api11Probe {
  /** One entry per `src1` fetch call. */
  calls: Array<{ at: number; keys: string[]; settings: unknown }>;
  /** When set, the next `src1` fetch calls `ctx.scheduleNext(value)` once and clears it. */
  scheduleNext?: number;
}

export function probe(): Api11Probe {
  const g = globalThis as { __api11?: Api11Probe };
  g.__api11 ??= { calls: [] };
  return g.__api11;
}

export function resetProbe(): Api11Probe {
  const p = probe();
  p.calls.length = 0;
  p.scheduleNext = undefined;
  return p;
}

const ANY = `{ safeParse: (v) => ({ success: true, data: v ?? {} }), parse: (v) => v ?? {} }`;

const SRC1 = `const g = (globalThis.__api11 ??= { calls: [] });
const settings = ${ANY};
const reference = {
  safeParse: (v) =>
    v && typeof v === "object" && typeof v.k === "string" && v.k !== ""
      ? { success: true, data: { k: v.k } }
      : { success: false, error: { issues: [{ path: ["k"], message: "Expected a key" }] } },
};
const refKey = (r) => r.k;
const parseReference = async (input) =>
  typeof input === "string" && input.trim() ? { ok: { k: input.trim() } } : { error: "Enter a key such as a:1" };
async function fetch(refs, ctx) {
  g.calls.push({ at: Date.now(), keys: refs.map(refKey), settings: ctx.settings });
  if (g.scheduleNext !== undefined) {
    const ms = g.scheduleNext;
    g.scheduleNext = undefined;
    ctx.scheduleNext(ms);
  }
  return new Map(refs.map((r) => [r.k, { data: { k: r.k } }]));
}
const resolvers = { echo: async (input, ctx) => ({ input, settings: ctx.settings }) };
export default {
  settings,
  reference,
  refKey,
  batchKey: (_settings, ref) => ref.k.split(":")[0],
  parseReference,
  fetch,
  resolvers,
  mock: { fetch, parseReference, resolvers },
};
`;

const COMP = `export default {
  settings: ${ANY},
  actions: {
    async add(payload, ctx) {
      if (!payload || typeof payload.k !== "string") return { error: "A key is required" };
      const prev = ctx.widget.refs().at(-1);
      const ref = ctx.widget.track("src1", { k: payload.k });
      if (prev && prev.id !== ref.id) ctx.widget.link(prev.id, ref.id);
      return { ok: true, message: String(ref.id) };
    },
    async echo(payload, ctx) {
      return { ok: true, message: JSON.stringify(await ctx.plugins.resolve("src1", "echo", payload)) };
    },
  },
  async onData(data) {
    return { meta: { n: data.items.length } };
  },
};
`;

const ANY_SCHEMA = { type: "object" };

function manifest(id: string, extra: Record<string, unknown>) {
  return {
    id,
    name: `@opsdash/fixture-${id}`,
    version: "1.1.0",
    apiVersion: "^1.1.0",
    server: "server.js",
    client: "client.js",
    env: [],
    refresh: { interval: "60s", timeout: "5s" },
    ...extra,
  };
}

function write(pluginsDir: string, id: string, m: Record<string, unknown>, server: string) {
  const dist = join(pluginsDir, id, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "opsdash.manifest.json"), JSON.stringify(m, null, 2));
  writeFileSync(join(dist, "server.js"), server);
  writeFileSync(join(dist, "client.js"), "export default function Widget() { return null; }\n");
}

/**
 * Writes `src1` and `comp` into `pluginsDir`, plus `comp-bare`: the same composite without `settingsSchema`,
 * which the host must refuse.
 */
export function writeApi11Plugins(pluginsDir: string): void {
  write(
    pluginsDir,
    "src1",
    manifest("src1", {
      capabilities: ["track"],
      settingsSchema: ANY_SCHEMA,
      referenceSchema: ANY_SCHEMA,
      hasMock: true,
    }),
    SRC1,
  );
  write(
    pluginsDir,
    "comp",
    manifest("comp", { capabilities: ["actions"], composes: ["src1"], settingsSchema: ANY_SCHEMA }),
    COMP,
  );
  write(pluginsDir, "comp-bare", manifest("comp-bare", { capabilities: ["actions"], composes: ["src1"] }), COMP);
}

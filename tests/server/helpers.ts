import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { type Opsdash, type OpsdashOptions, startOpsdash } from "../../src/server/server.ts";

export const REPO = resolve(import.meta.dirname, "../..");
export const PLUGINS_DIR = join(REPO, "plugins");
export const EXAMPLES = join(REPO, "examples/config");

export function tmp(prefix = "opsdash-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes a config directory from `{ "opsdash.yaml": "...", "more.yaml": "..." }`. */
export function writeConfig(files: Record<string, string>, dir = tmp("opsdash-config-")): string {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

export function copyExamples(): string {
  const dir = tmp("opsdash-config-");
  cpSync(EXAMPLES, dir, { recursive: true });
  return dir;
}

export interface LogLine {
  level: number;
  event?: string;
  msg?: string;
  [k: string]: unknown;
}

export class LogCapture extends Writable {
  lines: LogLine[] = [];
  raw = "";
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    const text = chunk.toString();
    this.raw += text;
    for (const line of text.split("\n").filter(Boolean)) this.lines.push(JSON.parse(line));
    cb();
  }
  events(name: string): LogLine[] {
    return this.lines.filter((l) => l.event === name);
  }
}

export interface Harness {
  ops: Opsdash;
  logs: LogCapture;
  close(): Promise<void>;
}

export async function start(opts: Partial<OpsdashOptions> & { configDir: string }): Promise<Harness> {
  const logs = new LogCapture();
  const ops = await startOpsdash({
    pluginsDir: PLUGINS_DIR,
    dbFile: join(tmp("opsdash-db-"), "store.db"),
    mock: true,
    port: 0,
    hostname: "127.0.0.1",
    watch: false,
    timers: false,
    logDestination: logs,
    processEnv: {},
    ...opts,
  });
  return { ops, logs, close: () => ops.close() };
}

export interface SseClient {
  events: Array<{ event: string; data: any }>;
  waitFor(
    pred: (e: { event: string; data: any }) => boolean,
    timeoutMs?: number,
  ): Promise<{ event: string; data: any }>;
  close(): void;
}

/** Minimal SSE reader over fetch. */
export async function sse(baseUrl: string, dashboard: string): Promise<SseClient> {
  const ctrl = new AbortController();
  const res = await fetch(`${baseUrl}/api/events?dashboard=${encodeURIComponent(dashboard)}`, { signal: ctrl.signal });
  if (!res.ok || !res.body) throw new Error(`SSE failed: ${res.status}`);
  const events: SseClient["events"] = [];
  const waiters: Array<() => void> = [];
  (async () => {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        for (let idx = buf.indexOf("\n\n"); idx >= 0; idx = buf.indexOf("\n\n")) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data !== undefined) {
            events.push({ event, data: JSON.parse(data) });
            for (const w of waiters.splice(0)) w();
          }
        }
      }
    } catch {}
  })();
  const client: SseClient = {
    events,
    async waitFor(pred, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = events.find(pred);
        if (hit) return hit;
        if (Date.now() > deadline)
          throw new Error(`Timed out waiting for SSE event; got ${events.map((e) => e.event).join(",")}`);
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 50);
        });
      }
    },
    close: () => ctrl.abort(),
  };
  await client.waitFor((e) => e.event === "snapshot");
  return client;
}

export const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

/** Minimal valid config using the reference plugin. */
export const refConfig = (dashboards: string, extra = "") => `version: 1
plugins:
  reference:
    version: "^1.0.0"
${extra}
dashboards:
${dashboards}
`;

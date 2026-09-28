import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeBuild {
  number: number;
  url: string;
  result: string | null;
  building: boolean;
  timestamp: number;
  duration: number;
  estimatedDuration: number;
}

export interface FakeJob {
  name: string;
  url: string;
  lastBuild: FakeBuild | null;
  lastSuccessfulBuild: { number: number; timestamp: number; url: string } | null;
}

export interface FakeRequest {
  method: string;
  path: string;
  pipeline: string;
  tree: string | null;
  headers: IncomingHttpHeaders;
}

export interface FakeJenkins {
  url: string;
  requests: FakeRequest[];
  /** When set, every request gets 429 with this `retry-after` (seconds). */
  rateLimit: number | null;
  close(): Promise<void>;
}

/**
 * A fake Jenkins: `GET /job/<seg>/job/<seg>/api/json?tree=…` returns the pipeline's jobs (names only for
 * `tree=jobs[name]`), and 404 for unknown pipelines. Counts requests and records headers. `build` may be a
 * function of the server's base URL, so job URLs can point back at the fake.
 */
export async function startFakeJenkins(
  build: Record<string, FakeJob[]> | ((baseUrl: string) => Record<string, FakeJob[]>),
): Promise<FakeJenkins> {
  let pipelines: Record<string, FakeJob[]> = {};
  const fake: Omit<FakeJenkins, "url" | "close"> = { requests: [], rateLimit: null };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    const parts = url.pathname.split("/").filter(Boolean);
    const tree = url.searchParams.get("tree");
    const segments: string[] = [];
    let ok = parts.length >= 4 && parts.at(-2) === "api" && parts.at(-1) === "json";
    for (let i = 0; ok && i < parts.length - 2; i += 2) {
      if (parts[i] !== "job" || parts[i + 1] === undefined) ok = false;
      else segments.push(decodeURIComponent(parts[i + 1]!));
    }
    const pipeline = segments.join("/");
    fake.requests.push({ method: req.method ?? "", path: url.pathname, pipeline, tree, headers: req.headers });
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (fake.rateLimit !== null) return send(429, { message: "slow down" }, { "retry-after": String(fake.rateLimit) });
    const jobs = ok && req.method === "GET" ? pipelines[pipeline] : undefined;
    if (!jobs) return send(404, { message: "Not Found" });
    if (tree === "jobs[name]")
      return send(200, { _class: "WorkflowMultiBranchProject", jobs: jobs.map((j) => ({ name: j.name })) });
    send(200, { _class: "WorkflowMultiBranchProject", jobs });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  pipelines = typeof build === "function" ? build(url) : build;
  return Object.assign(fake, {
    url,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  });
}

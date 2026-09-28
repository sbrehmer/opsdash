import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeJiraIssue {
  key: string;
  summary: string;
  status: string;
  /** Jira status category key: "new", "indeterminate" or "done". */
  categoryKey: string;
  assignee: string | null;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface FakeJira {
  url: string;
  requests: RecordedRequest[];
  issues: Map<string, FakeJiraIssue>;
  /** When set, every request answers 429 with this `retry-after` (seconds). */
  rateLimit: number | null;
  close(): Promise<void>;
}

const raw = (i: FakeJiraIssue) => ({
  id: String(10_000 + Number(i.key.split("-")[1])),
  key: i.key,
  fields: {
    summary: i.summary,
    status: { name: i.status, statusCategory: { key: i.categoryKey } },
    assignee: i.assignee ? { displayName: i.assignee } : null,
  },
});

/**
 * Fake Jira on `node:http` serving both APIs: Cloud `POST /rest/api/3/issue/bulkfetch` (unknown keys →
 * `issueErrors`) and Data Center `POST /rest/api/2/search` (with `validateQuery: "warn"`, unknown keys in a
 * `key in (…)` JQL become `warningMessages` instead of a 400). Records every request.
 */
export async function startFakeJira(issues: FakeJiraIssue[]): Promise<FakeJira> {
  const fake: Omit<FakeJira, "url" | "close"> = {
    requests: [],
    issues: new Map(issues.map((i) => [i.key, i])),
    rateLimit: null,
  };
  const server: Server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    const path = req.url ?? "/";
    fake.requests.push({ method: req.method ?? "", path, headers: req.headers, body });
    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };
    if (fake.rateLimit !== null)
      return send(429, { message: "rate limited" }, { "retry-after": String(fake.rateLimit) });
    if (req.method !== "POST") return send(405, {});
    const b = (body ?? {}) as Record<string, unknown>;

    if (path === "/rest/api/3/issue/bulkfetch") {
      const keys = (b.issueIdsOrKeys as string[] | undefined) ?? [];
      const found = keys.map((k) => fake.issues.get(k.toUpperCase())).filter((i) => i !== undefined);
      const missing = keys.filter((k) => !fake.issues.has(k.toUpperCase()));
      return send(200, {
        expand: "schema,names",
        issues: found.map(raw),
        issueErrors: missing.length
          ? [
              {
                issueIdsOrKeys: missing,
                errorMessages: ["Issue does not exist or you do not have permission to see it."],
              },
            ]
          : [],
      });
    }

    if (path === "/rest/api/2/search") {
      const jql = String(b.jql ?? "");
      const m = /^key in \(([^)]*)\)$/.exec(jql);
      if (!m) return send(400, { errorMessages: ["Unsupported JQL"] });
      const keys = m[1]!
        .split(",")
        .map((k) => k.trim().toUpperCase())
        .filter(Boolean);
      const missing = keys.filter((k) => !fake.issues.has(k));
      if (missing.length && b.validateQuery !== "warn") {
        return send(400, { errorMessages: missing.map((k) => `An issue with key '${k}' does not exist.`) });
      }
      const found = keys.map((k) => fake.issues.get(k)).filter((i) => i !== undefined);
      const max = typeof b.maxResults === "number" ? b.maxResults : 50;
      return send(200, {
        startAt: 0,
        maxResults: max,
        total: found.length,
        issues: found.slice(0, max).map(raw),
        warningMessages: missing.map((k) => `An issue with key '${k}' does not exist.`),
      });
    }

    return send(404, { errorMessages: ["Not found"] });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

/** `count` deterministic issues `PROJ-1` … `PROJ-<count>`. */
export function jiraIssues(count: number, project = "PROJ"): FakeJiraIssue[] {
  const statuses: Array<[string, string]> = [
    ["To Do", "new"],
    ["In Progress", "indeterminate"],
    ["Done", "done"],
  ];
  return Array.from({ length: count }, (_, i) => {
    const [status, categoryKey] = statuses[i % 3]!;
    return {
      key: `${project}-${i + 1}`,
      summary: `Issue ${i + 1}`,
      status,
      categoryKey,
      assignee: i % 4 === 0 ? null : `Person ${i % 4}`,
    };
  });
}

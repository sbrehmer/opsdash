import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakePr {
  title: string;
  state?: "OPEN" | "CLOSED" | "MERGED";
  isDraft?: boolean;
  author?: string;
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  headRefName?: string;
  checks?: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | null;
  mergedAt?: string | null;
  closedAt?: string | null;
}

export interface FakeGithub {
  url: string;
  /** Known pull requests by `owner/name#n`. */
  prs: Map<string, FakePr>;
  requests: Array<{ method: string; url: string; headers: IncomingHttpHeaders; body: string }>;
  /** When set, every request gets a 429 with `retry-after: 30`. */
  rateLimited: boolean;
  close(): Promise<void>;
}

const ALIAS =
  /(p\d+): repository\(owner: ("(?:[^"\\]|\\.)*"), name: ("(?:[^"\\]|\\.)*")\) \{ pullRequest\(number: (\d+)\)/g;

/** A GitHub GraphQL endpoint at `POST /graphql` that answers the `p<i>` aliases built by `buildPrQuery`. */
export async function startFakeGithub(prs: Record<string, FakePr> = {}): Promise<FakeGithub> {
  const fake: FakeGithub = {
    url: "",
    prs: new Map(Object.entries(prs)),
    requests: [],
    rateLimited: false,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      fake.requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      if (fake.rateLimited) {
        res.writeHead(429, { "retry-after": "30", "content-type": "application/json" });
        return res.end(JSON.stringify({ message: "rate limited" }));
      }
      if (req.method !== "POST" || req.url !== "/graphql") {
        res.writeHead(404);
        return res.end();
      }
      const query: string = JSON.parse(body).query;
      const data: Record<string, unknown> = {};
      const errors: unknown[] = [];
      for (const m of query.matchAll(ALIAS)) {
        const [, alias, owner, name, number] = m;
        const repo = `${JSON.parse(owner!)}/${JSON.parse(name!)}`;
        const pr = fake.prs.get(`${repo}#${number}`);
        if (!pr) {
          data[alias!] = null;
          errors.push({
            type: "NOT_FOUND",
            path: [alias],
            message: `Could not resolve to a Repository with the name '${repo}'.`,
          });
          continue;
        }
        data[alias!] = {
          pullRequest: {
            title: pr.title,
            url: `https://github.example/${repo}/pull/${number}`,
            state: pr.state ?? "OPEN",
            isDraft: pr.isDraft ?? false,
            author: { login: pr.author ?? "octocat" },
            reviewDecision: pr.reviewDecision ?? null,
            headRefName: pr.headRefName ?? `feature/${number}`,
            mergedAt: pr.mergedAt ?? null,
            closedAt: pr.closedAt ?? null,
            updatedAt: "2026-09-01T10:00:00Z",
            commits: { nodes: pr.checks ? [{ commit: { statusCheckRollup: { state: pr.checks } } }] : [] },
          },
        };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(errors.length ? { data, errors } : { data }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return fake;
}

import { type FetchResults, type PluginContext, sourceRequest } from "@opsdash/plugin-sdk";
import type { JiraIssue, JiraRef, JiraSettings, StatusCategory } from "./types.ts";

export const FIELDS = ["summary", "status", "assignee"];
export const NOT_FOUND = "not found or no access";

/** The subset of a Jira REST issue (v2 search and v3 bulkfetch) that the plugin reads. */
export interface RawIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } } | null;
    assignee?: { displayName?: string } | null;
  };
}

const CATEGORIES: Record<string, StatusCategory> = { new: "todo", indeterminate: "inprogress", done: "done" };

/** Maps a raw Jira issue to the plugin's item shape (research R6). `baseUrl` must not end with "/". */
export function mapIssue(issue: RawIssue, baseUrl: string): JiraIssue {
  const { fields } = issue;
  return {
    key: issue.key,
    url: `${baseUrl}/browse/${issue.key}`,
    title: fields.summary ?? "",
    status: fields.status?.name ?? "",
    category: CATEGORIES[fields.status?.statusCategory?.key ?? ""] ?? "inprogress",
    assignee: fields.assignee?.displayName ?? null,
  };
}

/** Real Jira source (T041): one request per batch, Cloud bulkfetch or Data Center JQL search. */
export async function fetchIssues(refs: JiraRef[], ctx: PluginContext<JiraSettings>): Promise<FetchResults> {
  const { deployment, email, token } = ctx.settings;
  const baseUrl = ctx.settings.baseUrl.replace(/\/+$/, "");
  const secret = ctx.secrets.get(token.env);
  const keys = refs.map((r) => r.key);

  let issues: RawIssue[];
  if (deployment === "cloud") {
    const res = await sourceRequest<{ issues?: RawIssue[] }>(
      `${baseUrl}/rest/api/3/issue/bulkfetch`,
      {
        tool: "Jira",
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${email ?? ""}:${secret}`).toString("base64")}` },
        json: { issueIdsOrKeys: keys, fields: FIELDS },
      },
      ctx,
    );
    issues = res.issues ?? [];
  } else {
    const res = await sourceRequest<{ issues?: RawIssue[] }>(
      `${baseUrl}/rest/api/2/search`,
      {
        tool: "Jira",
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        json: { jql: `key in (${keys.join(",")})`, fields: FIELDS, maxResults: keys.length, validateQuery: "warn" },
      },
      ctx,
    );
    issues = res.issues ?? [];
  }

  // Jira may answer with the canonical key casing; match case-insensitively. Keys listed in
  // `issueErrors` (Cloud) or missing from the results (both) become per-item errors.
  const byKey = new Map(issues.map((i) => [i.key.toUpperCase(), i]));
  const results: FetchResults = new Map();
  for (const key of keys) {
    const issue = byKey.get(key.toUpperCase());
    results.set(key, issue ? { data: mapIssue(issue, baseUrl) } : { error: NOT_FOUND });
  }
  return results;
}

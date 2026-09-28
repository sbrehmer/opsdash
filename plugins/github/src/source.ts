import { type FetchResults, type PluginContext, SourceError, sourceRequest } from "@opsdash/plugin-sdk";
import { buildPrQuery, mapPrNode, type PrNode } from "./query.ts";
import { type GithubRef, type GithubSettings, refKeyOf } from "./types.ts";

interface GraphqlResponse {
  data?: Record<string, { pullRequest: PrNode | null } | null> | null;
  errors?: Array<{ type?: string; message?: string; path?: Array<string | number> }>;
}

const NOT_FOUND = "not found or no access";

/** Real GitHub source: one GraphQL POST per batch (research R7). */
export async function fetchPullRequests(refs: GithubRef[], ctx: PluginContext<GithubSettings>): Promise<FetchResults> {
  const results: FetchResults = new Map();
  if (refs.length === 0) return results;
  const token = ctx.secrets.get(ctx.settings.token.env);
  const body = await sourceRequest<GraphqlResponse>(
    ctx.settings.apiUrl,
    {
      tool: "GitHub",
      method: "POST",
      headers: { authorization: `bearer ${token}` },
      json: { query: buildPrQuery(refs) },
      defaultRetryAfterMs: 60_000,
    },
    ctx,
  );
  if (!body.data) {
    // GitHub can also report a rate limit as a 200 with a RATE_LIMITED error and no data.
    if (body.errors?.some((e) => e.type === "RATE_LIMITED"))
      throw new SourceError("GitHub rate limit reached", 200, 60_000);
    throw new SourceError("GitHub query failed", 200);
  }
  refs.forEach((ref, i) => {
    const node = body.data?.[`p${i}`]?.pullRequest;
    results.set(refKeyOf(ref), node ? { data: mapPrNode(node, ref) } : { error: NOT_FOUND });
  });
  return results;
}

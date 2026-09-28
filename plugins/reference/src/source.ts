import type { FetchResults, PluginContext } from "@opsdash/plugin-sdk";

export interface ReferenceRef {
  key: string;
}

export interface ReferenceItem {
  key: string;
  title: string;
  status: "open" | "in-progress" | "done";
  updatedAt: number;
}

export const SOURCE_REQUESTS_KEY = "__source.requests";

const STATUSES = ["open", "in-progress", "done"] as const;

/**
 * In-process stand-in for a real source system (no network). It needs REFERENCE_TOKEN like a real
 * integration would, and answers any list of keys in a single call. Asking for LEAK-1 throws an error
 * whose message contains the token, so tests can prove the host redacts secrets.
 */
export async function simulatedBatchLookup(
  refs: ReferenceRef[],
  ctx: PluginContext<{ apiToken?: { env: string } }>,
): Promise<FetchResults> {
  const token = ctx.secrets.get(ctx.settings.apiToken?.env ?? "REFERENCE_TOKEN");
  ctx.state.set(SOURCE_REQUESTS_KEY, (ctx.state.get<number>(SOURCE_REQUESTS_KEY) ?? 0) + 1);
  if (refs.some((r) => r.key === "LEAK-1")) throw new Error(`Source rejected request with token ${token}`);
  const results: FetchResults = new Map();
  for (const { key } of refs) {
    const n = Number(key.split("-")[1] ?? 0);
    results.set(key, {
      data: { key, title: `Item ${key}`, status: STATUSES[n % 3], updatedAt: Date.now() } satisfies ReferenceItem,
    });
  }
  return results;
}

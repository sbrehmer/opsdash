import type { PluginContext } from "./types.ts";

/** An HTTP failure from a source system. Never carries request headers or credential-bearing bodies. */
export class SourceError extends Error {
  override name = "SourceError";
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(message: string, status = 0, retryAfterMs?: number) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Thrown by `ctx.plugins.resolve` when the plugin or resolver does not exist. */
export class ResolverError extends Error {
  override name = "ResolverError";
}

function retryAfter(res: Response): number | undefined {
  const ra = res.headers.get("retry-after");
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(ra);
    if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  }
  const reset = res.headers.get("x-ratelimit-reset");
  if (reset && Number.isFinite(Number(reset))) return Math.max(0, Number(reset) * 1000 - Date.now());
  return undefined;
}

export interface SourceRequestInit extends Omit<RequestInit, "body" | "signal"> {
  /** Name used in error messages, for example "GitHub". */
  tool: string;
  /** JSON body; sets content-type. */
  json?: unknown;
  /** Default retry delay for 403/429 without rate-limit headers. */
  defaultRetryAfterMs?: number;
}

/**
 * `fetch` for plugin sources: passes `ctx.signal`, sends/parses JSON, and turns non-2xx responses into
 * `SourceError` with `retryAfterMs` for rate limits (429, or 403 with rate-limit headers). Error messages
 * never include headers or response bodies, so credentials cannot leak through them.
 */
export async function sourceRequest<T = unknown>(url: string, init: SourceRequestInit, ctx: PluginContext): Promise<T> {
  const { tool, json, defaultRetryAfterMs, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    signal: ctx.signal,
    headers: {
      accept: "application/json",
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(headers as Record<string, string>),
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  if (!res.ok) {
    const limited =
      res.status === 429 ||
      (res.status === 403 && (res.headers.has("retry-after") || res.headers.get("x-ratelimit-remaining") === "0"));
    const wait = limited ? (retryAfter(res) ?? defaultRetryAfterMs ?? 60_000) : undefined;
    await res.body?.cancel();
    throw new SourceError(limited ? `${tool} rate limit reached` : `${tool} responded ${res.status}`, res.status, wait);
  }
  return (await res.json()) as T;
}

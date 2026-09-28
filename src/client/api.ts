import type { ActionResult } from "../shared/api-types.ts";

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** Runs a widget action on the server; non-2xx responses resolve to `{ error }`. */
export async function runAction(path: string, name: string, payload?: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(`/api/widgets/${encodeURIComponent(path)}/actions/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    if (!res.ok) return { error: typeof body.error === "string" ? body.error : `Action failed (${res.status})` };
    return body as ActionResult;
  } catch (err) {
    return { error: `Action failed: ${(err as Error).message}` };
  }
}

export const widgetUrl = (path: string) => `/api/widgets/${encodeURIComponent(path)}/items`;

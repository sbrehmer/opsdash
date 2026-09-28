import type { ParseResult } from "@opsdash/plugin-sdk";
import { type JiraRef, KEY } from "./types.ts";

/** Accepts `PROJ-88` or an issue URL such as `https://acme.atlassian.net/browse/PROJ-88`. */
export function parseJiraInput(input: string): ParseResult<JiraRef> {
  const text = input.trim();
  const key = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/.exec(text)?.[1] ?? text.toUpperCase();
  return KEY.test(key) ? { ok: { key } } : { error: "Expected a Jira issue key like PROJ-88 or an issue URL" };
}

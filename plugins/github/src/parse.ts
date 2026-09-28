import type { ParseResult } from "@opsdash/plugin-sdk";
import { type GithubRef, REPO } from "./types.ts";

const ERROR = "Expected a pull request like owner/name#12, a pull request URL, or #12 with a default repository";

/**
 * Accepts `owner/name#12`, `https://<any host>/owner/name/pull/12`, or `#12` when a default repository is
 * configured.
 */
export function parseGithubInput(input: string, defaultRepo?: string): ParseResult<GithubRef> {
  const text = input.trim();
  let repo: string | undefined;
  let num: string | undefined;
  const url = /^https?:\/\/[^/]+\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\/?(?:[?#].*)?$/.exec(text);
  const short = /^([\w.-]+\/[\w.-]+)?#(\d+)$/.exec(text);
  if (url) [, repo, num] = url;
  else if (short) {
    repo = short[1] ?? defaultRepo;
    num = short[2];
    if (!repo) return { error: "No default repository is configured; use owner/name#12" };
  }
  if (!repo || !num || !REPO.test(repo)) return { error: ERROR };
  const number = Number(num);
  if (!Number.isSafeInteger(number) || number < 1) return { error: ERROR };
  return { ok: { repo, number } };
}

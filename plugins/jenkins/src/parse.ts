import type { ParseResult } from "@opsdash/plugin-sdk";
import type { JenkinsRef } from "./types.ts";

const HELP = "Expected a Jenkins job like folder/pipeline/PR-7 or a job URL (…/job/pipeline/job/PR-7/)";

/** Accepts `a/b/PR-7` (the last segment is the job) or a job URL `<baseUrl>/job/a/job/b/job/PR-7/` on any host. */
export function parseJenkinsInput(input: string): ParseResult<JenkinsRef> {
  const text = input.trim();
  let segments: string[];
  if (/^https?:\/\//i.test(text)) {
    let path: string;
    try {
      path = new URL(text).pathname;
    } catch {
      return { error: HELP };
    }
    const parts = path.split("/").filter(Boolean);
    const first = parts.indexOf("job");
    if (first < 0) return { error: HELP };
    segments = [];
    for (let i = first; i < parts.length; i += 2) {
      if (parts[i] !== "job" || parts[i + 1] === undefined) break;
      try {
        segments.push(decodeURIComponent(parts[i + 1]!));
      } catch {
        return { error: HELP };
      }
    }
  } else {
    if (/\s/.test(text)) return { error: HELP };
    segments = text.split("/").filter(Boolean);
  }
  if (segments.length < 2) return { error: HELP };
  const job = segments.pop()!;
  return { ok: { pipeline: segments.join("/"), job } };
}

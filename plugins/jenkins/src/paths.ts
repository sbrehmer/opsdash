import type { JenkinsSettings } from "./types.ts";

type PathSettings = Pick<JenkinsSettings, "pipelines" | "pipelineTemplate" | "defaultOwner">;

/** Research R8: every branch job with its last build and last successful build. */
export const TREE =
  "jobs[name,url,lastBuild[number,result,building,timestamp,duration,estimatedDuration,url],lastSuccessfulBuild[number,timestamp,url]]";

/** Pipeline path for a repository: `pipelines[repo]`, else the template with `{owner}` and `{name}` filled in. */
export function pipelineFor(repo: string, settings: PathSettings): string {
  const mapped = settings.pipelines[repo];
  if (mapped) return mapped;
  const [owner = "", name = ""] = repo.split("/");
  return settings.pipelineTemplate.replaceAll("{owner}", owner).replaceAll("{name}", name);
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Repository for a pipeline path: reverse lookup in `pipelines`, then the template as a regex. */
export function repoFor(pipeline: string, settings: PathSettings): string | undefined {
  for (const [repo, path] of Object.entries(settings.pipelines)) if (path === pipeline) return repo;
  const template = settings.pipelineTemplate;
  if (!template.includes("{owner}") && !template.includes("{name}")) return undefined;
  const names: string[] = [];
  const source = template
    .split(/(\{owner\}|\{name\})/)
    .map((part) => {
      if (part === "{owner}" || part === "{name}") {
        const key = part.slice(1, -1);
        if (names.includes(key)) return `\\k<${key}>`;
        names.push(key);
        return `(?<${key}>[^/]+)`;
      }
      return escapeRegex(part);
    })
    .join("");
  const m = new RegExp(`^${source}$`).exec(pipeline);
  const owner = m?.groups?.owner ?? settings.defaultOwner;
  const name = m?.groups?.name;
  // Without an {owner} placeholder the owner comes from `defaultOwner` (otherwise it is unknowable).
  return owner && name ? `${owner}/${name}` : undefined;
}

/** `"a/b"` → `"/job/a/job/b"`, URL-encoding each segment. */
export function jobPath(pipeline: string): string {
  return pipeline
    .split("/")
    .filter(Boolean)
    .map((seg) => `/job/${encodeURIComponent(seg)}`)
    .join("");
}

/** Browser URL of a job in a pipeline. */
export function jobUrl(baseUrl: string, pipeline: string, job: string): string {
  return `${baseUrl.replace(/\/$/, "")}${jobPath(pipeline)}/job/${encodeURIComponent(job)}/`;
}

# Contract: Jira, GitHub, Jenkins and Delivery plugins

All four plugins target plugin API `^1.1.0`. Credentials are always `{ env: NAME }` references
(`secret()`). Every source is read-only. Mock sources implement the same `fetch`,
`parseReference` and `resolvers`, and read `ctx.mockFaults` (standard faults plus `scenario`).

## `jira`

| | |
|-|-|
| Manifest | `capabilities: ["track"]`, `env: ["JIRA_TOKEN"]` (the name is configurable), `refresh: 60s / 10s`, `maxBatchSize: 100` |
| Settings | `deployment: "cloud" \| "datacenter"`, `baseUrl: url`, `email?: string` (required when `cloud`), `token: secret()`, `projectKeys: string[]` (default `[]`) |
| Reference | `{ key }`; `refKey = key` |
| `batchKey` | `"default"`: one request per site |
| `fetch` | Cloud: `POST {baseUrl}/rest/api/3/issue/bulkfetch` `{ issueIdsOrKeys, fields: ["summary","status","assignee"] }`, with `Authorization: Basic base64(email:token)`. Keys listed in `issueErrors` → `{ error: "not found or no access" }`. Data Center: `POST {baseUrl}/rest/api/2/search` `{ jql: "key in (…)", fields, maxResults, validateQuery: "warn" }` with `Authorization: Bearer token`; keys missing from the results → the same error. |
| Mock scenario | `{ status: { "PROJ-1": "In Review" } }` overrides seeded statuses |

## `github`

| | |
|-|-|
| Manifest | `capabilities: ["track"]`, `env: ["GITHUB_TOKEN"]`, `refresh: 60s / 10s`, `maxBatchSize: 50` |
| Settings | `apiUrl` (default `https://api.github.com/graphql`; GitHub Enterprise Server uses `https://<host>/api/graphql`), `webUrl` (default `https://github.com`), `token: secret()`, `defaultRepo?: "owner/name"` |
| Reference | `{ repo, number }`; `refKey = "repo#number"` |
| `batchKey` | `"default"`: one GraphQL request per host |
| `fetch` | `POST apiUrl` `{ query }` with aliases `p<i>: repository(owner, name) { pullRequest(number) { …fields } }` (research R7). `Authorization: bearer token`. A `null` pull request or a `NOT_FOUND` error → `{ error: "not found or no access" }`. 403 or 429 (or a `RATE_LIMITED` GraphQL error) → throw `SourceError("GitHub rate limit reached")` with `retryAfterMs`, and the host backs off generically. |
| Mock | Deterministic by `refKey`. Title `PROJ-<n mod 97>: <summary>`, branch `feature/PROJ-<n mod 97>-<slug>`. Scenario `{ merged: [...], closed: [...], draft: [...], changesRequested: [...], failingChecks: [...], mergedAgoDays: { "<refKey>": 8 } }` |

## `jenkins`

| | |
|-|-|
| Manifest | `capabilities: ["track"]`, `env: ["JENKINS_TOKEN"]`, `refresh: 60s / 10s` |
| Settings | `baseUrl: url`, `user: string`, `token: secret()`, `pipelines: Record<"owner/name", "folder/pipeline">` (default `{}`), `pipelineTemplate: string` (default `"{name}"`; placeholders `{owner}` and `{name}`), `defaultOwner?: string` (the owner used when the template has no `{owner}`), `mainBranch` (default `"main"`), `runningRefreshInterval` (default `"10s"`) |
| Reference | `{ pipeline, job }`; `refKey = "pipeline/job"` |
| `batchKey(settings, ref)` | `ref.pipeline`: one request per pipeline |
| `fetch` | `GET {baseUrl}/job/<pipeline segments joined by /job/>/api/json?tree=jobs[name,url,lastBuild[number,result,building,timestamp,duration,estimatedDuration,url],lastSuccessfulBuild[number,timestamp,url]]`, with `Authorization: Basic base64(user:token)`. Each requested job → `data` (data-model §Jenkins). A job missing from the response → `{ data: { pipeline, job, exists: false, build: null, main } }` (not an error). The tracker shows "waiting for first build" while the pull request is open, and "job no longer exists" once it is merged or closed. `main` comes from the job named `mainBranch`. If any build is running → `ctx.scheduleNext(runningRefreshInterval)`. |
| Resolver `jobForPullRequest({ repo, number })` | Returns `{ ok: { pipeline, job: "PR-<number>" }, pending?: true }`, with the pipeline from `pipelines[repo]` or the template. One request, `GET {pipeline}/api/json?tree=jobs[name]`. If the pipeline returns 404 → `{ error: "No Jenkins pipeline <pipeline> for <repo>" }`. If the job is missing from the list → `pending: true` (the webhook hasn't created it yet). |
| Resolver `pullRequestForJob({ pipeline, job })` | Returns `{ ok: { repo, number } }` when the job matches `^PR-(\d+)$` and the pipeline maps back to a repository (the reverse of `pipelines`, then the template). Otherwise it returns `{ error }` explaining why. |
| Mock | Build state is seeded by job key; scenario `{ running: [...], failed: [...], unstable: [...], noBuild: [...], noJob: [...], unknownPipelines: [pipelines], mainNeverSucceeded: [pipelines] }`. Running builds started `(now mod estimate)` ago, so their progress advances. Resolvers mirror the real rules: jobs in `noJob` give `pending: true` and `exists: false`, and pipelines in `unknownPipelines` give the "No Jenkins pipeline" error. |

## `delivery` (composite)

| | |
|-|-|
| Manifest | `capabilities: ["actions"]`, `composes: ["github", "jenkins", "jira"]`, `env: []` |
| Widget settings | `retention` (duration, default `"7d"`), `storyProjects?: string[]` (defaults to the Jira plugin's `projectKeys`; empty means any `[A-Z][A-Z0-9_]+-\d+`) |
| `onData` | Removes rows whose pull request is `merged` or `closed` and whose `mergedAt` or `closedAt` is older than `retention` (cascade), then returns `meta.dismissed`. |

### Actions

Payloads are JSON. Results are `{ ok: true }` or `{ error }`; the host maps errors to HTTP 422.

| Action | Payload | Behaviour |
|--------|---------|-----------|
| `addRow` | `{ pr?: string, job?: string, story?: string }`, with at least one of `pr` or `job` | Parses each field with its own plugin. Infers the missing half through the Jenkins resolvers. When both are given, checks that `pullRequestForJob(job)` equals the pull request. Rejects a pull request already in this widget with "already tracked". Then, in one transaction, tracks the pull request, the job and the optional story, and links pr→job and pr→story. |
| `setStory` | `{ pr: refKey, story: string }` | Parses the story, tracks it, and replaces the pull request's story link. The old story is removed if nothing else links to it. |
| `removeStory` | `{ pr: refKey }` | Unlinks the story and removes it if nothing else links to it. |
| `linkSuggestion` | `{ pr: refKey, story: key }` | The same as `setStory`. |
| `dismissSuggestion` | `{ pr: refKey, story: key }` | Adds the key to `dismissed:<path>:<pr>`. |
| `reinferJob` | `{ pr: refKey }` | Runs `jobForPullRequest` again and replaces the job link. |
| `setJob` | `{ pr: refKey, job: string }` | Parses the job, checks it builds this pull request, and replaces the job link. |
| `removeRow` | `{ pr: refKey }` | Untracks the pull request with cascade. |

### Client (tracker widget)

- **Layout**: grouped by `data.repo` of each row's pull request. The group header shows the
  repository, a link, and `main.lastSuccessAt` from any row's job (relative, with the exact time
  on hover or focus). Rows use attention ordering (data-model).
- **Cells**:
  - **Story**: key link, title, status label, assignee. If there is no story, the cell shows the
    suggestion ("Link PROJ-12" or "Dismiss") or "+ Story".
  - **Pull request**: `repo#n` link, title, author, state label, review label, checks label.
  - **Build**: job link, result label and time, or a running progress bar with `%` and time
    remaining (or "running, over estimate"), or "waiting for first build".
- **Row menu**: change story, remove story, re-infer job, set job, remove row.
- **Add form**: pull request, build job and story inputs, with the action's error shown inline.
- **Done section**: a collapsed `<details>` element with a count.
- **Cell errors**: each cell shows its own error or stale state using the item's own freshness.

## Standalone widgets (`jira`, `github`, `jenkins`)

Each is a compact list of the widget's tracked items with the same cell renderers as the tracker.
The renderers live in a workspace package, `@opsdash/delivery-cells`, which each plugin's client
bundles at build time, so there is no runtime coupling between plugins. The standalone widgets use
the host track and untrack controls (capability `track`). The Jenkins list also shows each
job's `main.lastSuccessAt`.

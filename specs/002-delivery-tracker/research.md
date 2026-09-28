# Research: Delivery Tracker

Phase 0 output for [plan.md](./plan.md). This feature builds on the host from
[001-dashboard-host](../001-dashboard-host/plan.md): TypeScript on Node 24, Hono, Vite 8 with Preact,
SQLite through Drizzle, and plugin API 1.0.0. Every decision below adds to that stack. None
replaces it.

## R1. How the tracker combines three plugins (FR-027, constitution Principle I)

- **Decision**: The tracker is a fourth plugin, `delivery`. It is a **composite plugin** that has
  no source of its own. Its manifest declares `composes: ["github", "jenkins", "jira"]`.
  - **Storage**: the rows of a tracker widget are ordinary tracked references stored under that
    widget's path. Each reference is owned by its real plugin (`github`, `jenkins` or `jira`) and
    connected with host links (story ↔ PR ↔ job).
  - **Fetching**: the host treats a composite widget's references owned by plugin X as data needs
    of X. They go into X's normal batched cycle, using X's plugin-level settings. The tracker
    therefore adds no requests of its own.
  - **Delivery to the widget**: whenever any contributing plugin finishes a cycle, the host
    rebuilds the composite widget's data and pushes it. The data contains every item with its
    owning plugin, the links between items, and optional plugin-provided `meta`.
- **Rationale**: This keeps the core free of widget-specific logic (Principle I). The tracker is
  just another plugin. Plugins never call each other's fetch code, and the host keeps full
  control of batching (constitution: host-coordinated fetching). Rows follow every existing host
  rule: per-widget storage, deleting orphans, identifiers only.
- **Alternatives considered**:
  - A tracker built into the core. Rejected because it breaks Principle I.
  - A tracker that fetches through the other plugins itself. Rejected because it would bypass host
    batching and de-duplication and duplicate requests.
  - A shared "row" table in the store. Rejected because links already model relationships, so a
    new table would be a second mechanism.

## R2. Row editing: widget actions (FR-002 to FR-005, FR-021, FR-022)

- **Decision**: Plugin API 1.1 adds **widget actions**. A plugin declares
  `actions: { name: (payload, ctx) => result }`. The host exposes
  `POST /api/widgets/:path/actions/:name`, and the client SDK gives widgets
  `actions.run(name, payload)`.
  - **Scope**: actions change only Opsdash's own store (tracked references, links and plugin
    state) through `ctx.widget`, and only for the calling widget. They never touch source systems,
    in line with Principle III.
  - **Manifest**: a plugin opts in with the manifest capability `"actions"`.
  - **Tracker actions**: `addRow`, `setStory`, `removeStory`, `linkSuggestion`,
    `dismissSuggestion`, `reinferJob`, `setJob` and `removeRow`.
- **Rationale**: A row is more than one reference, and the existing single-input track route can't
  express adding several related items, linking them, or dismissing a suggestion. Named actions
  are generic, can be tested, and keep the tracker's logic inside the tracker plugin.
- **Alternatives considered**:
  - Extending the track route with structured payloads. Rejected because it becomes a
    special case per plugin.
  - Letting widgets write to the store from the browser. Rejected because it would give up
    validation and scoping.

## R3. Inference across plugins (FR-003, FR-016, FR-028)

- **Decision**: Plugin API 1.1 adds **resolvers**. A source (real or mock) may export
  `resolvers: { name: (input, ctx) => output }`. Another plugin calls one through
  `ctx.plugins.resolve(pluginId, name, input)`, and parses input with another plugin's parser
  through `ctx.plugins.parse(pluginId, input)`. The host runs the target plugin's code with the
  target's own context: its plugin-level settings, its declared secrets and its state.
  - The Jenkins plugin exports `jobForPullRequest({ repo, number })` and
    `pullRequestForJob({ pipeline, job })`.
- **How the Jenkins resolvers work**:
  - Job for PR: the pipeline comes from `pipelines[repo]`, or the `pipelineTemplate`
    (default `{name}`). The job is `PR-<number>`. Existence is confirmed with one job API request.
  - PR for job: the job name `PR-<n>` gives the number, and the reverse pipeline mapping gives the
    repository. A job that isn't named `PR-<n>` is rejected with an explanation.
- **Rationale**: Inference is Jenkins knowledge, so it lives in the Jenkins plugin. The tracker
  depends only on a named, documented resolver contract, never on another plugin's internals, as
  FR-028 and the constitution require. Mock sources ship matching resolvers, so inference works
  in mock mode.
- **Alternatives considered**:
  - Reading `CHANGE_ID` from build parameters. Rejected because it needs an extra request for each
    job, and the naming convention is guaranteed for multibranch pipelines.
  - Putting inference in the tracker. Rejected because the tracker would then need Jenkins' URL
    and credentials.

## R4. Grouping references into batches (FR-010, FR-012, FR-015)

- **Decision**: In plugin API 1.1, `batchKey(settings, ref)` receives the reference as a second
  argument, which is backward compatible. The host groups each reference on its own.
  - **Jenkins** returns the pipeline path, which gives one request per pipeline.
  - **GitHub** and **Jira** return `"default"`, which gives one request per site.
  - **References from composite widgets** use the owning plugin's plugin-level settings.
- **Rationale**: Jenkins has to group by pipeline, which is a property of the reference, not of
  the widget. Nothing else in the scheduler changes, and chunking by `maxBatchSize` still applies.

## R5. Faster refresh while builds run (FR-032)

- **Decision**: The context gains `ctx.scheduleNext(ms)`. While fetching, a plugin can ask for its
  next tick to happen after `ms`, once. The host replaces each plugin's fixed `setInterval` with a
  chain of `setTimeout` calls. Each delay is `min(requested, interval)`, and if nothing was
  requested it goes back to the interval. The rule against overlapping runs (host FR-026) is
  unchanged.
  - **Jenkins**: its fetch calls `ctx.scheduleNext(runningRefreshInterval)` (default 10 s) when any
    returned build is running. Because only visible widgets are fetched, this applies only to
    visible running builds.
  - **Rate limits**: plugins use the same call to back off, with `ctx.scheduleNext(retryAfterMs)`.
    The host then takes the maximum of the requested delay and the rate-limit delay.
- **Between refreshes**: the tracker's progress bar moves smoothly because it is calculated in the
  browser from `timestamp` and `estimatedDuration`, with a one-second local timer. This adds no
  server requests.
- **Alternatives considered**:
  - A fixed 15 s interval. Rejected because it quadruples Jenkins load while nothing is running.
  - Webhooks. Out of scope.

## R6. Jira batching and API differences (FR-009, FR-010, FR-018)

- **Decision**:
  - **Jira Cloud**: `POST {base}/rest/api/3/issue/bulkfetch` with
    `{ issueIdsOrKeys, fields: ["summary","status","assignee"] }`. This returns issues plus
    `issueErrors` for missing or forbidden keys, so partial results come in one request. Up to 100
    keys per call (`maxBatchSize: 100`). Authentication is Basic `email:token`.
  - **Jira Data Center/Server**: `POST {base}/rest/api/2/search` with the JQL
    `key in (…)`, `validateQuery: "warn"` (missing keys become warnings instead of a 400), the same
    fields, and `maxResults = n`. Authentication is Bearer with a personal access token.
  - **Status category**: the `status.statusCategory.key` values `new`, `indeterminate` and `done`
    map to "to do", "in progress" and "done".
- **Rationale**: Both give one request per batch and handle missing keys gracefully, which a plain
  JQL search on Cloud does not (a single unknown key fails the whole query).

## R7. GitHub batching (FR-011, FR-012, FR-018)

- **Decision**: One GraphQL query per batch, with aliased fields:
  `p0: repository(owner:…, name:…) { pullRequest(number: …) { …PR } }`, and so on.
  - **Endpoints**: `https://api.github.com/graphql` for GitHub.com and
    `https://<host>/api/graphql` for Enterprise Server. The endpoint is set in config as `apiUrl`.
  - **Fields**: `title url state isDraft author{login} reviewDecision headRefName mergedAt closedAt
    updatedAt` and
    `commits(last:1){nodes{commit{statusCheckRollup{state}}}}`.
  - **Missing or forbidden pull requests**: these come back as `null` with a `NOT_FOUND` entry in
    `errors[]`, which is mapped to a per-item "not found or no access" error.
  - **Batch size**: `maxBatchSize: 50` keeps each query well under the node and cost limits.
  - **Rate limits**: a 403 or 429 with `retry-after` (or `x-ratelimit-reset`) throws
    `SourceError` with `retryAfterMs`. The host backs off generically (R5), so the cells go stale
    instead of failing.
- **Rationale**: GraphQL is the only GitHub API that fetches pull requests from several
  repositories in one call. A plain `fetch` POST is enough, so no client library is needed
  (Principle IV).

## R8. Jenkins batching and data (FR-013 to FR-016)

- **Decision**: One request per pipeline:
  `GET {base}/job/<seg>/job/<seg>/api/json?tree=jobs[name,url,lastBuild[number,result,building,timestamp,duration,estimatedDuration,url],lastSuccessfulBuild[number,timestamp,url]]`.
  - **What it covers**: the response includes every branch job, both PR jobs and the main job, so
    one call covers all of the pipeline's tracked jobs plus the main branch's last successful
    build.
  - **Results**: each requested job becomes an item. Jobs missing from the response become
    "job no longer exists".
  - **Authentication**: Basic `user:apiToken`.
- **Rationale**: Jenkins' `tree` parameter is the standard way to batch job status. Pipeline paths
  that contain folders map to repeated `/job/` segments.

## R9. HTTP from plugins, and credentials

- **Decision**: Plugins use Node's built-in `fetch`. The SDK adds a small helper,
  `sourceRequest(url, init, ctx)`, which:
  - passes `ctx.signal`;
  - turns HTTP errors into `SourceError { status, retryAfterMs }`;
  - never includes request headers in error messages.

  Credentials come from `secret()` settings (`{ env: NAME }`) and are read with `ctx.secrets.get`,
  which registers them for redaction. The Jira email and the Jenkins user are plain settings; they
  are not secret.
- **Rationale**: No HTTP library is needed. The helper keeps error handling and redaction
  consistent across the three plugins, which is shared behaviour that belongs in the SDK.

## R10. Mock sources that agree with each other (FR-017, US5)

- **Decision**: Each plugin's mock is deterministic by key, and the mocks follow shared conventions,
  so the three tools agree without sharing any code.
  - **GitHub mock**: pull request `owner/name#n` has the head branch `feature/PROJ-<n mod 97>` and
    the title `PROJ-<n mod 97>: <seeded summary>`, which gives story suggestions.
  - **Jenkins mock**: resolvers follow the real naming rules (`PR-<n>`, pipeline from the
    mapping). Build state is seeded by job key. "Running" builds get a start time that moves with
    the clock, so progress visibly advances and builds finish.
  - **Jira mock**: any valid key returns a seeded title, status and assignee.
  - **Scenarios**: plugin config gains `mock.scenario`, a free-form object that the host passes as
    `ctx.mockFaults.scenario`. It lets a plugin support its own named mock scenarios, for example
    `github: { merged: ["acme/web#12"] }` or `jenkins: { running: ["web/PR-7"], failed: [...] }`.
- **Sample rows**: rows are data, not config, so the example config cannot contain them. A seed
  script, `pnpm seed:delivery`, adds sample rows through the public action API of a running
  instance. The quickstart and the E2E tests use it.

## R11. Store change: uniqueness per plugin

- **Decision**: Migration `0001` replaces `unique(widget_path, ref_key)` with
  `unique(widget_path, plugin_id, ref_key)`, because one widget now holds references from several
  plugins. The untrack route accepts `?plugin=` (defaulting to the widget's plugin) and
  `?cascade=1`, which also removes linked references in the same widget that end up with no links.
  Cascading is used when a whole row is removed; a story linked to other rows is kept.
- **Rationale**: This is required for composite widgets and has no effect on existing data,
  because every existing row belongs to a single plugin. It is covered by a migration test.

## R12. Tracker UI

- **Decision**: The tracker widget is a Preact client module in `plugins/delivery`.
  - **Layout**: a `<table>` grouped by repository, with a `<tbody>` per group and a header row
    showing the repository and the main branch's last successful build. Container queries switch
    each row to a stacked card when the widget is under 640 px wide, so the layout follows the
    widget's width, not the viewport's.
  - **Status labels**: every status has a text label as well as its colour (FR-023).
  - **Done section**: a native `<details>` element.
  - **Add form**: three inputs (pull request, build job, story) with inline errors from the action
    results.
  - **Links**: open in a new tab with `rel="noopener noreferrer"`.
- **Rationale**: Native table semantics give the best accessibility for tabular status. Container
  queries are supported in every evergreen browser.

## R13. Testing the real sources without network access

- **Decision**: Contract tests start an in-process `node:http` server with small Jira, GitHub and
  Jenkins fixture endpoints. The real sources are pointed at it through `baseUrl` or `apiUrl`. The
  tests assert:
  - the request count per refresh (SC-002);
  - query shapes (JQL and bulkfetch bodies, GraphQL aliases, Jenkins `tree`);
  - authentication headers;
  - handling of missing items and rate limits;
  - redaction of credentials.

  Mock sources are tested with the existing plugin contract suite, extended to all four plugins.
- **Rationale**: This exercises the real code paths without adding dependencies (such as MSW or
  nock) and without network access in CI.

## Dependency changes

None. Everything uses Node built-ins (`fetch`, `node:http` in tests) and the existing stack.

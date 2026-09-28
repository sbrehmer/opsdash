---

description: "Task list for Delivery Tracker (Jira, GitHub and Jenkins plugins)"
---

# Tasks: Delivery Tracker (Jira, GitHub and Jenkins plugins)

**Input**: Design documents from `specs/002-delivery-tracker/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (plugin-api-1.1,
plugins, http-api, config-example), quickstart.md

**Tests**: These are included because the constitution requires contract tests for plugin API and
config changes, plus migration tests, and because the spec's success criteria (request counts,
isolation, secret scan and WCAG) need automated checks. Every test runs in mock mode or against
in-process fake servers.

**Organization**: Tasks are grouped by user story (US1 to US5 in spec.md). Phase 2 delivers plugin
API 1.1 and the four plugin packages with their mock sources, which every story depends on.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 to US5

---

## Phase 1: Setup

- [X] T001 Scaffold the plugin packages `plugins/jira`, `plugins/github`, `plugins/jenkins` and `plugins/delivery`. Each has a `package.json` (version `1.0.0`, an `opsdash` block per contracts/plugins.md with `apiVersion: "^1.1.0"`, and scripts `build` / `dev` / `typecheck` like `plugins/reference/package.json`), a `vite.config.ts` using `opsdashPlugin()`, a `tsconfig.json` (copied from `plugins/reference`), and a `src/css-modules.d.ts`.
- [X] T002 [P] Scaffold the workspace package `packages/delivery-cells` (`package.json` named `@opsdash/delivery-cells`, `exports: { ".": "./src/index.ts" }`, peer dependency `preact`, `tsconfig.json`), and add it as a dependency of all four plugins.
- [X] T003 [P] Update the root `package.json` `build` script to build every `plugins/*` package (for example `pnpm -r --filter "./plugins/*" --filter @opsdash/web run build`), add the script `"seed:delivery": "node scripts/seed-delivery.mjs"`, and add the `size-limit` entries in `.size-limit.json`: `plugins/{jira,github,jenkins}/dist/client.js` ≤ 15 KB gzipped and `plugins/delivery/dist/client.js` ≤ 20 KB gzipped.
- [X] T004 Run `pnpm install` and confirm that `pnpm -r run typecheck` still passes.

---

## Phase 2: Foundational (Plugin API 1.1 + plugin skeletons with mocks)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests (write first)

- [X] T005 [P] Migration test in `packages/host/tests/integration/store-0001.test.ts`: create a store at migration 0000 with a row in `tracked_ref`, open it with the new host, and assert that:
  - the row survives;
  - `unique(widget_path, plugin_id, ref_key)` is enforced (the same `widget_path` and `ref_key` under two plugins is allowed, and the same triple is rejected);
  - the old `unique(widget_path, ref_key)` index is gone.
- [X] T006 [P] API 1.1 contract test in `tests/contract/delivery/api-1.1.test.ts`, using two tiny fixture plugins generated in the test (like `tests/fixtures/plugins/variants.ts`): a source plugin `src1` with `resolvers.echo`, and a composite `comp` with `composes: ["src1"]`, an `actions.add` and an `onData`. It asserts:
  - (a) references tracked in a `comp` widget but owned by `src1` are fetched in `src1`'s batch, and `comp`'s `widget-data` has `items[].plugin`, `items[].id`, `links` and `meta`;
  - (b) `ctx.plugins.resolve("src1", "echo", x)` runs with `src1`'s settings;
  - (c) `ctx.scheduleNext(50)` makes the next tick happen after about 50 ms, once;
  - (d) `batchKey(settings, ref)` groups by reference;
  - (e) actions route status codes 200, 422, 404 and 400;
  - (f) untrack with `?plugin=&cascade=1` removes unlinked leftovers;
  - (g) the existing `plugins/reference` still loads and `tests/contract/plugin-api.test.ts` passes unchanged (FR-029);
  - (h) an empty `comp` widget publishes `state: "empty"` on subscribe, rather than staying on `loading`;
  - (i) straight after `actions.add`, `src1` is fetched for the new reference and the `comp` widget receives data with no timer tick (`timers: false`);
  - (j) the `comp` manifest without `settingsSchema` is refused.

### Implementation

- [X] T007 Add the API 1.1 types to `packages/plugin-sdk/src/types.ts`:
  - `PLUGIN_API_VERSION = "1.1.0"`;
  - `PluginManifestSource.composes?: string[]`;
  - `batchKey?(settings, ref)`;
  - `Source.resolvers?`, `PluginDefinition.actions?` and `onData?`, with `reference`, `refKey`, `parseReference`, `fetch` and `mock` optional when `composes` is set;
  - `ActionResult`, `ActionContext` (with `widget: { path, settings, refs(), links(), track(pluginId, ref), untrack(refId, { cascade? }), link(a, b), unlink(a, b), transaction(fn) }`);
  - on `PluginContext`: `scheduleNext(ms)`, `plugins: { parse(pluginId, input), resolve(pluginId, name, input) }`, and `mockFaults.scenario?: unknown`.

  Also make `definePlugin` accept composites (`jsonSchemas` always emits `settingsSchema` and emits `referenceSchema` only when a reference exists), and have the Vite preset (`packages/plugin-sdk/src/vite.ts`) write `composes` into the manifest. A composite plugin's manifest MUST still contain `settingsSchema` (constitution: every manifest declares its configuration schema).
- [X] T008 [P] Implement `packages/plugin-sdk/src/http.ts`:
  - `SourceError { status, retryAfterMs }` and `ResolverError`;
  - `sourceRequest(url, init, ctx)`, which uses built-in `fetch` with `ctx.signal` and JSON parsing. A non-2xx response throws `SourceError` with the message `"<Tool> responded <status>"` (it never includes headers or the body when the body could echo credentials). `retryAfterMs` comes from `retry-after` (seconds) or `x-ratelimit-reset` (epoch seconds).

  Export all of these from `src/index.ts`.
- [X] T009 [P] Extend the client SDK in `packages/plugin-sdk/src/client/index.ts`: `WidgetItem` gains `plugin`, `id?`, `state?` and `lastSuccessAt?`, and `WidgetProps` gains `links?: {from,to}[]`, `meta?: unknown` and `actions: { run(name, payload): Promise<ActionResult> }`.
- [X] T010 Add migration 0001 in `packages/host/src/store/schema.ts`: change `tracked_ref`'s unique constraint to `unique("tracked_ref_widget_plugin_key").on(t.widgetPath, t.pluginId, t.refKey)`, then run `pnpm exec drizzle-kit generate --name per_plugin_refs` in `packages/host`. Update `packages/host/src/store/repos.ts`:
  - `untrackRef(widgetPath, pluginId, refKey)`;
  - `untrackById(id)`;
  - `cascadeRemove(id, widgetPath)`, which deletes the reference and then the linked references in the same widget that are left with zero links, in one transaction;
  - `listLinksForWidget(widgetPath)`;
  - `unlink(a, b)`;
  - `listRefs` returning `pluginId` and `id`.
- [X] T011 Update the manifest checks in `packages/host/src/plugins/manifest.ts`:
  - add `"actions"` to `SUPPORTED_CAPABILITIES`;
  - for manifests with `composes` (an array of plugin id strings), don't require `referenceSchema` or a mock (`hasMock` may be absent), but still require `settingsSchema`;
  - accept `apiVersion` ranges satisfied by `PLUGIN_API_VERSION` `1.1.0`.

  In `packages/host/src/plugins/registry.ts`, have the server import check require `fetch`, `mock`, `reference`, `refKey` and `parseReference` only for non-composite plugins.
- [X] T012 Extend `packages/host/src/plugins/context.ts`:
  - `scheduleNext(ms)`, which records into a per-run collector the scheduler supplies;
  - `plugins.parse(pluginId, input)` and `plugins.resolve(pluginId, name, input)`, which look up the target in the registry, build the target's own context (its plugin-level settings from the resolved config, its manifest `env`, a fresh `AbortSignal.timeout` with the target's timeout, and the same `mockFaults` source), and call `mock` or the real `parseReference` / `resolvers[name]` (throwing `ResolverError` when the plugin or resolver is missing);
  - `createActionContext(deps, pluginId, widget)`, which adds `ctx.widget` backed by the repositories, where `track` validates with the owning plugin's `reference.safeParse` and computes the `refKey` with that plugin's `refKey`, returning the existing reference on a duplicate.
- [X] T013 Update the planner in `packages/host/src/refresh/plan.ts`:
  - compute `batchKey` per reference with `plugin.batchKey?.(settings, ref)`;
  - accept "foreign needs": for plugin X, also collect the references owned by X that are tracked in visible composite widgets whose manifest `composes` includes X, using X's plugin-level settings (`resolved.set.plugins[X].value.settings`, parsed through X's schema) as their settings.
- [X] T014 Update the scheduler in `packages/host/src/refresh/scheduler.ts`: *(Also: a run requested through `scheduleNext` skips the result cache, so the 10 s refresh while builds run keeps reaching Jenkins. This was found by `status.test.ts`.)*
  - replace `setInterval` with a `setTimeout` chain per plugin, where the next delay is `min(requested, interval)` from `scheduleNext`, or the rate-limit back-off (the maximum) when a `SourceError` has `retryAfterMs`;
  - keep the rule against overlapping runs;
  - keep per-item results (`latestItems: Map<"plugin|batchKey|refKey", { result, fetchedAt, lastSuccessAt, state }>`);
  - after each plugin run, rebuild every visible composite widget containing that plugin's references (`items` with `plugin`, `id`, per-item `state` and `lastSuccessAt`, plus `links`), call `onData(data, actionCtx)` (and rebuild again when it pruned anything), attach the returned `meta`, and publish;
  - composite widgets whose owning plugin isn't loaded get per-item errors of the form "plugin <id> is not installed";
  - `runPaths(paths)` is composite-aware: a composite widget's path expands into runs of each owning plugin, limited to that widget's references;
  - composite widget data is also assembled and published without waiting for a plugin run: when a viewer subscribes (the snapshot), when the widget has no references (it publishes `state: "empty"` with `items: []`), and right after every action, using the latest per-item results available.
- [X] T015 [P] Add `mock.scenario: z.record(z.string(), z.unknown()).optional()` to `mockFaultsSchema` in `packages/host/src/config/schema.ts`, and pass it through `PluginRuntime.mockFaults`.
- [X] T016 Implement `packages/host/src/http/actions.ts`, `POST /api/widgets/:path/actions/:name`: 404 for an unknown widget or action; 400 without the `actions` capability; build the action context; wrap the action so that thrown errors become 422 with a redacted message; on `{ ok }`, publish the widget's data immediately through the composite assembly in T014, then trigger `scheduler.runPaths([path])` (composite-aware), and return 200. Mount it in `packages/host/src/http/app.ts`.
- [X] T017 Update `packages/host/src/http/tracking.ts`: `GET` items include `plugin` and `id`; `DELETE` accepts `?plugin=` (defaulting to the widget's plugin) and `?cascade=1`; `POST` stores under the widget's plugin as before. Update `packages/web/src/widget/TrackControls.tsx` to send `?plugin=` when it untracks.
- [X] T018 Pass `links`, `meta` and `actions.run` (POST to the actions route) to plugin widgets in `packages/web/src/widget/Widget.tsx`, and add `links` and `meta` to `WidgetData` in `packages/web/src/api.ts` and `packages/host/src/refresh/types.ts`.
- [X] T019 [P] Jira plugin skeleton and mock in `plugins/jira/src/server.ts` and `plugins/jira/src/mock.ts`:
  - settings `z.strictObject({ deployment: z.enum(["cloud","datacenter"]), baseUrl: z.url(), email: z.string().optional(), token: secret(), projectKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]+$/)).default([]) })`, refined so that `email` is required when `deployment === "cloud"`;
  - reference `z.strictObject({ key: z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/) })`;
  - `refKey = key`;
  - `parseReference` accepts `PROJ-88` or `…/browse/PROJ-88`;
  - `batchKey` returns `"default"`;
  - `createMockSource` generates `{ key, url: "<baseUrl>/browse/KEY", title, status, category, assignee }` seeded by key (statuses `To Do`, `In Progress`, `In Review` or `Done`, mapped to `todo`, `inprogress` or `done`), and `scenario.status[key]` overrides the status.

  The real `fetch` is a stub throwing "not implemented" until T041. Manifest: `env: ["JIRA_TOKEN"]`, `maxBatchSize: 100`. Add a placeholder `plugins/jira/src/client.tsx` (a `defineWidget` that renders `refKey` and `data.title` in a `<ul>`) so the build succeeds; T045 replaces it.
- [X] T020 [P] GitHub plugin skeleton and mock in `plugins/github/src/server.ts` and `plugins/github/src/mock.ts`:
  - settings `{ apiUrl: z.url().default("https://api.github.com/graphql"), webUrl: z.url().default("https://github.com"), token: secret(), defaultRepo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).optional() }`;
  - reference `z.strictObject({ repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/), number: z.int().min(1) })`;
  - `refKey = "repo#number"`;
  - `parseReference` accepts `owner/name#n`, `<webUrl>/owner/name/pull/n`, or `#n` when `defaultRepo` is set;
  - the mock generates `{ repo, number, url, title: "PROJ-<n mod 97>: <seeded summary>", author, branch: "feature/PROJ-<n mod 97>-<slug>", state, review, checks, updatedAt, mergedAt, closedAt }`, seeded by `refKey`. Scenario lists `merged`, `closed`, `draft`, `changesRequested` and `failingChecks` override the seeded values, and `mergedAgoDays[refKey]` sets `mergedAt`.

  The real `fetch` is a stub until T042. Manifest: `env: ["GITHUB_TOKEN"]`, `maxBatchSize: 50`. Add a placeholder `plugins/github/src/client.tsx` (same as Jira's); T046 replaces it.
- [X] T021 [P] Jenkins plugin skeleton, mock and resolvers in `plugins/jenkins/src/server.ts`, `plugins/jenkins/src/mock.ts` and `plugins/jenkins/src/resolvers.ts`: *(Added the setting `defaultOwner`, so `pullRequestForJob` works with templates that have no `{owner}`.)*
  - settings `{ baseUrl: z.url(), user: z.string(), token: secret(), pipelines: z.record(z.string(), z.string()).default({}), pipelineTemplate: z.string().default("{name}"), mainBranch: z.string().default("main"), runningRefreshInterval: duration string default "10s" }`;
  - reference `z.strictObject({ pipeline: z.string().min(1), job: z.string().min(1) })`;
  - `refKey = "pipeline/job"`;
  - `parseReference` accepts `a/b/PR-7` (last segment is the job) or `<baseUrl>/job/a/job/b/job/PR-7/`;
  - `batchKey(settings, ref) = ref.pipeline`;
  - pure helpers `pipelineFor(repo, settings)` and `repoFor(pipeline, settings)` (reverse of `pipelines`, then the template turned into a regex);
  - the mock generates `{ pipeline, job, url, build: { number, url, result, building, startedAt, durationMs, estimatedDurationMs }, main: { branch, lastSuccessAt, url } }`, with running builds `startedAt = now - (now mod estimatedDurationMs)`;
  - job data includes `exists: boolean` (data-model §Jenkins);
  - scenario lists `running`, `failed`, `unstable`, `noBuild`, `noJob` (the job doesn't exist, so `exists: false`), `unknownPipelines` (pipelines) and `mainNeverSucceeded` (pipelines);
  - mock resolvers `jobForPullRequest` and `pullRequestForJob` follow the real rules. `jobForPullRequest` returns `{ ok: { pipeline, job }, pending: true }` for jobs in `noJob`, and `{ error }` for pipelines in `unknownPipelines`;
  - the mock's `fetch` calls `ctx.scheduleNext(runningRefreshInterval)` when any build is running.

  Real `fetch` and resolvers are stubs until T043. Add a placeholder `plugins/jenkins/src/client.tsx`; T047 replaces it.
- [X] T022 [P] Delivery plugin skeleton in `plugins/delivery/src/server.ts`: `definePlugin({ settings: z.strictObject({ retention: duration default "7d", storyProjects: z.array(z.string()).optional() }), actions: {}, onData })` with manifest `capabilities: ["actions"]`, `composes: ["github","jenkins","jira"]`, `env: []`; `onData` returns `{ meta: { dismissed: {} } }` for now. Add a placeholder `plugins/delivery/src/client.tsx`; T030 replaces it.
- [X] T023 Build all four plugins (`pnpm build`) and extend `tests/contract/plugin-api.test.ts` into a table-driven suite over `reference`, `jira`, `github` and `jenkins` in mock mode. It checks manifest validity, settings, reference and `refKey`, parse accept and reject, the mock being deterministic, partial errors through `errorKeys`, honouring `ctx.signal`, and state isolation. It also covers the `delivery` manifest (a composite with no source). *(Implemented as `tests/contract/delivery/plugins.test.ts`, a table-driven suite over all five plugins. `plugin-api.test.ts` is kept unchanged for FR-029.)*

**Checkpoint**: API 1.1 contract tests pass. Four plugins load in mock mode. The reference plugin is unchanged.

---

## Phase 3: User Story 1 - Track a change as one row (Priority: P1) 🎯 MVP

**Goal**: Add, infer, edit and remove tracker rows (PR + job + optional story) through actions,
shown in a basic tracker table.

**Independent Test**: In mock mode, add a row with only `acme/web#1423`. The row shows the PR and
the inferred `acme/web/PR-1423`, plus the suggestion `PROJ-65`. Adding by job alone, mismatched
input, duplicates, and editing the story or job all behave as in US1 scenarios 1 to 9.

### Tests for User Story 1

- [X] T024 [P] [US1] Contract test for the delivery actions in `tests/contract/delivery/delivery.test.ts`, starting the host in mock mode with a config holding all four plugins and a tracker widget `d/tracker`. It asserts:
  - `addRow {pr}` → 200, and the widget has a github reference, a jenkins reference `acme/web/PR-1423` and a pr→job link;
  - `addRow {job}` → PR inferred;
  - `addRow {pr, job mismatched}` → 422 "builds a different pull request";
  - `addRow {pr}` whose job is in the scenario's `noJob` → 200, and the job cell data has `exists: false` (rendered "waiting for first build" while the PR is open);
  - `addRow {pr}` whose repository's pipeline is in `unknownPipelines` → 422 "No Jenkins pipeline";
  - an empty tracker publishes `state: "empty"`, and a new row has data immediately after `addRow` (H2 and H3);
  - a duplicate PR → 422 "already tracked";
  - `setStory` and `removeStory` → links updated, and a story still linked elsewhere is kept;
  - `reinferJob` and `setJob` → one job link per PR (FR-001, the one-job rule);
  - `removeRow` → cascade;
  - `linkSuggestion` and `dismissSuggestion` → `meta.dismissed` updated.
- [X] T025 [P] [US1] E2E test `tests/e2e/delivery-rows.spec.ts` (desktop): open `#/delivery`; add PR `acme/web#1423` through the tracker form; see the job cell `acme/web/PR-1423` and the suggestion `PROJ-65`; choose **Link**, and the story cell shows `PROJ-65`; add a duplicate and see an inline error; remove the row. Also time the add-row flow (fill and submit until the row is visible) and assert it takes under 20 s in total, with the UI responding under 2 s (SC-001).

### Implementation for User Story 1

- [X] T026 [US1] Implement the row helpers in `plugins/delivery/src/rows.ts`:
  - `buildRows(items, links)` → `Row[] { pr: Item, job?: Item, story?: Item }`, keyed by the github reference and linked by `links`;
  - `findRow(ctx, prRefKey)`;
  - `storyKeys(text, projects)`, which extracts `[A-Z][A-Z0-9_]+-\d+` keys (filtered by `projects` when it's non-empty), looking at the title first, then the branch, and removing duplicates.
- [X] T027 [US1] Implement the actions in `plugins/delivery/src/actions.ts` per contracts/plugins.md §delivery: `addRow`, `setStory`, `removeStory`, `linkSuggestion`, `dismissSuggestion`, `reinferJob`, `setJob` and `removeRow`.
  - They parse each field with `ctx.plugins.parse`, infer through `ctx.plugins.resolve("jenkins", "jobForPullRequest" | "pullRequestForJob", …)`, and validate consistency.
  - All writes happen in `ctx.widget.transaction`.
  - Errors are plain sentences suitable for inline display.
  - Dismissals are stored in `ctx.state` under `dismissed:<path>:<prKey>`.

  Wire them into `plugins/delivery/src/server.ts`.
- [X] T028 [US1] Update `onData` in `plugins/delivery/src/server.ts` so that it returns `meta.dismissed`, a map of PR `refKey` to the dismissed keys, for the widget's rows. It also deletes `dismissed:<path>:<pr>` keys for PRs that are no longer tracked in the widget (data-model: dismissal cleanup), and `removeRow` deletes its own key. *(Dismissal keys are cleaned up for PRs that are no longer tracked. Cleanup for widgets removed from config is deferred; see data-model.md. `onData` also returns `meta.storyProjects` from the Jira `projectKeys` resolver.)*
- [X] T029 [P] [US1] Implement the base cell renderers in `packages/delivery-cells/src/index.tsx`: `StoryCell`, `PrCell` and `BuildCell`, each showing a key link (`target="_blank" rel="noopener noreferrer"`), a title and a text status label; an `ErrorCell` for item errors; and `cells.module.css`, which uses only `--od-*` tokens.
- [X] T030 [US1] Implement the tracker widget in `plugins/delivery/src/client.tsx` and `plugins/delivery/src/tracker.module.css`:
  - a `<table>` of rows (story | pull request | build | actions) built with `buildRows`;
  - an **Add** form (inputs "Pull request", "Build job", "Story (optional)", with labels, submitting `actions.run("addRow")` and showing errors inline in `role="alert"`);
  - a suggestion chip "Link PROJ-65 / Dismiss" in the empty story cell (hidden when dismissed through `meta`);
  - a row menu (a `<details>` element with buttons) for change story, remove story, re-infer job, set job and remove row.

**Checkpoint**: Rows can be created with inference and edited end to end in mock mode (MVP).

---

## Phase 4: User Story 2 - See live status for every item in a row (Priority: P1)

**Goal**: Full status in every cell, grouping by repository with the main branch's last successful
build, attention ordering, build progress, a Done section with retention, a 10 s refresh while
builds run, and per-cell isolation.

**Independent Test**: With mock scenarios (running, failed and succeeded builds; a merged PR; one
older than retention), rows show correct labels and progress, groups show the main-branch time,
Done holds the merged row, and the expired row is removed.

### Tests for User Story 2

- [X] T031 [P] [US2] Integration test `tests/contract/delivery/status.test.ts` (mock mode). It asserts:
  - a running Jenkins scenario makes `ctx.scheduleNext` produce a jenkins `refresh.cycle` within about 10 s (use a scaled `runningRefreshInterval: 200ms` in the test config), and it returns to the interval when nothing is running;
  - `mergedAgoDays: {"acme/web#77": 8}` together with the tracker `retention: 7d` removes that row in `onData` and logs `delivery.row.expired`;
  - `jenkins` mock `latencyMs: 20000` with `timeout: 1s` → jenkins items get `state: "timeout"`/`"stale"` while the github and jira items stay `ok` (FR-020, SC-005).
- [X] T032 [P] [US2] Unit tests `plugins/delivery/tests/rows.test.ts` covering attention ordering (data-model §Attention ordering), grouping by repository with groups sorted by their lowest rank, the done classification (merged or closed), and `storyKeys` extraction (title before branch, filtered by `projects`).

### Implementation for User Story 2

- [X] T033 [US2] Add to `plugins/delivery/src/rows.ts`:
  - `rank(row)`, returning 0 when the build result is `failure` or `unstable`, or the review is `changes_requested`, or the checks are `failure` or `error`; 1 when the build is running; otherwise 2;
  - `groupRows(rows)`, which groups by `pr.data.repo` and orders groups and rows per FR-026;
  - `isDone(row)`, true when the state is `merged` or `closed`;
  - `expired(row, retentionMs, now)`, based on `mergedAt ?? closedAt`.
- [X] T034 [US2] Implement retention in `plugins/delivery/src/server.ts` `onData`: for each done row that has expired, call `ctx.widget.untrack(pr.id, { cascade: true })` and log `{event: "delivery.row.expired", pr}`.
- [X] T035 [P] [US2] Extend the cell renderers in `packages/delivery-cells/src/index.tsx`:
  - `StoryCell`: status label with a category colour, and the assignee.
  - `PrCell`: state label (draft, open, merged or closed), review label, checks label and author.
  - `BuildCell`: result label with a relative finish time; while running, a progress bar (`<progress max=100>` with text "running · 42% · ~3 min left", or "running, over estimate" after 100%), recomputed every second by a `useEffect` interval from `startedAt` and `estimatedDurationMs`; "waiting for first build" when `build` is null.
  - `RelativeTime`: text such as "2 h ago" inside a `<time dateTime title>` element, with the exact time on hover or focus (FR-023).
  - Per-item freshness: a small "stale" badge from `item.state === "stale"` (with `lastSuccessAt`), and `ErrorCell` for `error`/`timeout`.
- [X] T036 [US2] Update the tracker in `plugins/delivery/src/client.tsx`:
  - render one `<tbody>` per repository group, with a header row showing the repository name and "main: last success 2 h ago" (from any row's `job.data.main`, or "no successful build" when `lastSuccessAt` is null);
  - order rows by `rank`;
  - render a Done section (`<details>` with "Done (n)") below the groups;
  - use container queries (`container-type: inline-size` on the widget root, and `@container (max-width: 640px)`) to switch rows to stacked cards (FR-025).

**Checkpoint**: The tracker is complete against mock data.

---

## Phase 5: User Story 3 - Status with the fewest possible requests (Priority: P1)

**Goal**: Real Jira, GitHub and Jenkins sources, batched per site or pipeline, with rate-limit
back-off, verified against fake servers.

**Independent Test**: With 30 rows across 3 repositories, one refresh against the fakes makes 1
Jira, 1 GitHub and 3 Jenkins requests, with correct authentication and partial results.

### Tests for User Story 3

- [X] T037 [P] [US3] Fake servers in `tests/contract/delivery/fakes.ts`, built on `node:http`, each counting requests and recording headers and bodies: *(Implemented as one fake per tool in `tests/contract/delivery/fakes/{jira,github,jenkins}.ts`.)*
  - Jira Cloud `POST /rest/api/3/issue/bulkfetch`, returning known issues and `issueErrors` for unknown ones;
  - Jira Data Center `POST /rest/api/2/search`, honouring `validateQuery: "warn"`;
  - GitHub `POST /graphql`, which parses aliases `p<i>` with a regex, returns known pull requests, returns `null` plus a `NOT_FOUND` error for unknown ones, and has a switch that returns 429 with `retry-after: 30`;
  - Jenkins `GET /job/<…>/api/json?tree=…`, per pipeline, returning PR jobs, the main job and `lastSuccessfulBuild` (or 404 for an unknown pipeline);
  - a 429 switch with `retry-after` on all three fakes (Jira and Jenkins as well as GitHub).
- [X] T038 [P] [US3] Real-source contract tests in `tests/contract/delivery/jira.test.ts`, `github.test.ts` and `jenkins.test.ts`, running the plugins outside mock mode against the fakes, with the tokens in `processEnv`. They assert: *(The source-level checks live in `jira.test.ts`, `github.test.ts` and `jenkins.test.ts`. The host back-off is generic, triggered by any thrown error with `retryAfterMs`, and is covered in `api-1.1.test.ts` and `status.test.ts`.)*
  - one request per refresh per site (Jira Cloud and Data Center both), one GraphQL request for 30 pull requests across 3 repositories, and 3 Jenkins requests for 3 pipelines (SC-002);
  - authentication headers: `Basic base64(email:token)` for Jira Cloud, `Bearer` for Jira Data Center, `bearer` for GitHub, `Basic user:token` for Jenkins;
  - unknown items become per-item "not found or no access";
  - the `main` values;
  - a 429 from GitHub, Jira or Jenkins makes that plugin's items stale, and its next tick is delayed by at least `retry-after` through the host's generic back-off (inspected through the scheduler);
  - the real resolvers: `jobForPullRequest` (pipeline has the job → `{ ok }`; pipeline lacks the job → `{ ok, pending: true }`; unknown pipeline → `{ error: "No Jenkins pipeline …" }`) and `pullRequestForJob`;
  - a job missing from the pipeline response → `data.exists === false`, not an error;
  - no token appears in logs or HTTP output (SC-007).
- [X] T039 [P] [US3] Batching test in `tests/contract/delivery/batching.test.ts` (mock mode): seed 30 rows across 3 repositories and 3 pipelines through `addRow`, open one or three SSE viewers, and assert from the `__mock.requests` counters and the `refresh.cycle` logs 1 Jira, 1 GitHub and 3 Jenkins requests per cycle. Also check that a PR tracked in both the tracker and the standalone GitHub widget is requested once (US3 scenario 4).

### Implementation for User Story 3

- [X] T040 [P] [US3] Implement the shared query builders as pure, unit-tested functions:
  - `plugins/github/src/query.ts`: `buildPrQuery(refs)`, which escapes strings with `JSON.stringify` and aliases `p<i>` with the fields from research R7, and `mapPrNode(node)` for the state (`isDraft` → `draft`, `MERGED` → `merged`, and so on), the review decision (lowercased) and the checks (`statusCheckRollup.state` lowercased, or null);
  - `plugins/jenkins/src/source.ts` helpers: `jobPath(pipeline)` → `/job/a/job/b`, and `TREE` (research R8);
  - `plugins/jira/src/source.ts`: `mapIssue(issue, baseUrl)`.
- [X] T041 [US3] Implement the real Jira fetch in `plugins/jira/src/source.ts` using `sourceRequest`.
  - Cloud: a bulkfetch body with `{ issueIdsOrKeys, fields: ["summary","status","assignee"] }` and Basic authentication. Keys in `issueErrors`, or missing from the response, become `{ error: "not found or no access" }`.
  - Data Center: search with `{ jql: "key in (K1,K2)", fields, maxResults: n, validateQuery: "warn" }` and Bearer authentication.
  - The token is read through `ctx.secrets.get(settings.token.env)`.
- [X] T042 [US3] Implement the real GitHub fetch in `plugins/github/src/source.ts`: `POST settings.apiUrl` with `{ query: buildPrQuery(refs) }` and `Authorization: bearer`, mapping `data.p<i>.pullRequest` to results and `null` to "not found or no access". Let `sourceRequest` throw `SourceError` with `retryAfterMs` on 403 or 429 (default 60 s for a GitHub rate limit when there's no header), so the host's generic back-off (T014) applies; the only GitHub-specific part is the error message "GitHub rate limit reached".
- [X] T043 [US3] Implement the real Jenkins source in `plugins/jenkins/src/source.ts` and `plugins/jenkins/src/resolvers.ts`.
  - `fetch` makes one `GET {baseUrl}{jobPath(pipeline)}/api/json?tree=TREE` per call (the host already groups by pipeline), maps each requested job (a job missing from the response becomes `{ data: { pipeline, job, exists: false, build: null, main } }`, not an error), takes `main` from the job named `mainBranch`, and calls `ctx.scheduleNext(parseDuration(runningRefreshInterval))` when any build is running.
  - `jobForPullRequest` builds the pipeline with `pipelineFor(repo)` and the job `PR-<n>`, then makes one request, `GET {pipeline}/api/json?tree=jobs[name]`. If the pipeline returns 404 → `{ error: "No Jenkins pipeline <pipeline> for <repo>" }`. If the job is listed → `{ ok }`. If it's not listed → `{ ok, pending: true }` (the webhook hasn't created it yet).
  - `pullRequestForJob` uses `/^PR-(\d+)$/` together with `repoFor(pipeline)`.
  - Authentication is Basic `user:token`.

**Checkpoint**: The real sources are verified against the fakes, with request counts at the minimum.

---

## Phase 6: User Story 4 - Use each plugin on its own (Priority: P2)

**Goal**: Standalone list widgets for Jira, GitHub and Jenkins, using the host's track and untrack
controls.

**Independent Test**: A dashboard with only the Jenkins widget: track `acme/web/PR-7` and see its
status and the main-branch time.

### Tests for User Story 4

- [X] T044 [P] [US4] E2E test `tests/e2e/delivery-standalone.spec.ts` (desktop): on `#/delivery`, track `PROJ-88` in Stories, `acme/api#12` in Pull requests, and `acme/web/PR-7` in Builds through the host track panel. Each widget shows its item with a status label, and the Builds widget shows "main: last success …".

### Implementation for User Story 4

- [X] T045 [P] [US4] Jira list widget in `plugins/jira/src/client.tsx`: a `<ul>` of `StoryCell` from `@opsdash/delivery-cells`, with `handlesStates` left at the default.
- [X] T046 [P] [US4] GitHub list widget in `plugins/github/src/client.tsx`: a `<ul>` of `PrCell`.
- [X] T047 [P] [US4] Jenkins list widget in `plugins/jenkins/src/client.tsx`: a `<ul>` of `BuildCell` with a `RelativeTime` line showing the main branch's last success for each job.

**Checkpoint**: Each plugin works on its own.

---

## Phase 7: User Story 5 - Ready-made delivery dashboard (Priority: P2)

**Goal**: An example Delivery dashboard and a seed script, working in mock mode, with a documented
real-mode setup.

**Independent Test**: `pnpm start --mock` + `pnpm seed:delivery` → `#/delivery` shows sample rows
from all three tools and the standalone widgets, with no errors, and passes axe.

### Tests for User Story 5

- [X] T048 [P] [US5] Extend `tests/contract/reference-config.test.ts` so that the dashboard list includes `delivery`, update the snapshot, and assert all four new plugins resolve with status `ok`.
- [X] T049 [P] [US5] Add `delivery` to the dashboard list in `tests/e2e/a11y.spec.ts`, after seeding rows through the actions API in a `beforeAll`, for both themes and the 360, 1280 and 3840 px viewports. Also assert no horizontal overflow (SC-008).
- [X] T050 [P] [US5] Add a missing-env check to `tests/contract/secret-scan.test.ts`: start with the example config outside mock mode, with only `GITHUB_TOKEN` set. `/api/status` lists `JIRA_TOKEN missing for plugin jira` and `JENKINS_TOKEN missing for plugin jenkins`, and the github items keep working against the fakes (US5 scenario 3).

### Implementation for User Story 5

- [X] T051 [US5] Add the `jira`, `github`, `jenkins` and `delivery` plugin entries to `examples/config/opsdash.yaml` (exactly as in contracts/config-example.md, with mock scenarios `jenkins: { running: ["acme/web/PR-1423"], failed: ["acme/api/PR-12"] }` and `github: { merged: ["acme/web#1401"], changesRequested: ["acme/api#12"] }`), and create `examples/config/dashboards/delivery.yaml` with the tracker and three standalone widgets. Include it from `opsdash.yaml`.
- [X] T052 [US5] Implement `scripts/seed-delivery.mjs`: options `--url` (default `http://localhost:4400`), `--rows` (default 8) and `--repos` (default 2). It posts `addRow` actions to `/api/widgets/delivery%2Ftracker/actions/addRow` with PRs `acme/<repo>#<n>`, some with a story and some job-only, and prints a summary.
- [X] T053 [US5] Document the Delivery dashboard in `README.md` (setup against real Jira, GitHub and Jenkins: the environment variables `JIRA_TOKEN`, `GITHUB_TOKEN` and `JENKINS_TOKEN`, the deployment settings, and the pipeline mapping) and in the plugin author guide `packages/plugin-sdk/README.md` (the API 1.1 sections: composite plugins, actions, resolvers, `scheduleNext`, `sourceRequest`, and per-reference `batchKey`).

**Checkpoint**: The complete feature is demonstrable from a clean start.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T054 [P] Performance check in `tests/e2e/delivery-perf.spec.ts`: seed 30 rows, then navigate to `#/delivery`, and every cell reaches a non-loading state within 2 s (SC-003).
- [X] T055 [P] Run `pnpm size` (all plugin client budgets from T003) and `pnpm perf:coldstart` (startup budget with seven plugins loaded), and fix any regressions.
- [X] T056 Update `specs/001-dashboard-host/contracts/plugin-api.md` with a pointer to the API 1.1 additions, and bump `PLUGIN_API_VERSION` in any docs that still say 1.0.0.
- [X] T057 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `OPSDASH_CHROMIUM=/usr/bin/chromium pnpm test:e2e`, work through every section of `specs/002-delivery-tracker/quickstart.md`, and fix any deviations.

---

## Dependencies & Execution Order

| Phase | Depends on | Notes |
|-------|------------|-------|
| 1 Setup | none | |
| 2 Foundational | 1 | Blocks every story: API 1.1, the migration, the four plugin skeletons with mocks |
| 3 US1 (P1) 🎯 | 2 | MVP: rows plus inference, with basic cells |
| 4 US2 (P1) | 3 (uses rows.ts and the tracker client) | Full status, grouping, Done and retention, adaptive refresh |
| 5 US3 (P1) | 2 | Real sources and fakes. Independent of US1 and US2 (they use mocks), so it can run in parallel with them. |
| 6 US4 (P2) | 2, plus the T029 cells (and T035 for full detail) | Standalone widgets |
| 7 US5 (P2) | 3, 4, 6 | Example dashboard, seed and docs |
| 8 Polish | all | |

### Within a phase

Tests come first (they should fail), then pure helpers, then plugin server code, then host wiring,
then the client UI.

### Parallel opportunities

- **Phase 2**: T008, T009, T015 and T019 to T022 are parallel once T007 lands. The host changes
  T010 to T014 are sequential, because they share the store and scheduler files.
- **After Phase 2**: US3 (T037 to T043) runs in parallel with US1 and US2. The three real sources
  T041, T042 and T043 are in different plugins, so they can run in parallel after T040.
- **US4**: T045 to T047 are parallel.

### Parallel example: User Story 3

```text
Task: "Fake servers in tests/contract/delivery/fakes.ts"           (T037)
Task: "Query builders in plugins/github/src/query.ts etc."         (T040)
Task: "Real Jira fetch in plugins/jira/src/source.ts"              (T041)
Task: "Real GitHub fetch in plugins/github/src/source.ts"          (T042)
Task: "Real Jenkins source in plugins/jenkins/src/source.ts"       (T043)
```

---

## Implementation Strategy

1. **MVP**: Phase 1, then Phase 2, then US1. Rows with inference work end to end in mock mode.
   Validate with quickstart §2.
2. **Complete P1**: US2 (full status, which makes the tracker useful at a glance) and US3 (real
   sources with minimal requests), in parallel.
3. **P2**: US4 standalone widgets, then US5 example dashboard and seed.
4. **Polish**: performance, budgets, docs, and the full quickstart.

## Notes

- API 1.1 must stay additive. The existing `tests/contract/plugin-api.test.ts` for `reference`
  must pass unchanged at every checkpoint (FR-029).
- No new runtime dependencies (plan).
- Nothing writes to Jira, GitHub or Jenkins. Every source call is a read (constitution III).

# Data Model: Delivery Tracker

Phase 1 output for [plan.md](./plan.md). It builds on the host's
[data model](../001-dashboard-host/data-model.md). Only identifiers and links are persisted.
Everything under "Live data" is fetched on every refresh and never stored.

## References (persisted in `tracked_ref.ref`)

| Plugin | Reference | `refKey` | Accepted input |
|--------|-----------|----------|----------------|
| `jira` | `{ key: string }`, where `key` matches `^[A-Z][A-Z0-9_]+-\d+$` | `PROJ-88` | `PROJ-88`, `<base>/browse/PROJ-88` |
| `github` | `{ repo: "owner/name", number: int ≥ 1 }` | `owner/name#1423` | `owner/name#1423`, `<web>/owner/name/pull/1423`, or `#1423` plus a default repo from settings |
| `jenkins` | `{ pipeline: string, job: string }`, where `pipeline` is a folder path such as `acme/web` | `acme/web/PR-1423` | `acme/web/PR-1423`, `<base>/job/acme/job/web/job/PR-1423/` |

## Tracker row (composite, persisted as references and links)

A row is stored under the tracker widget's path as:

```text
tracked_ref(github, owner/name#n)   ← the row's identity (primary)
tracked_ref(jenkins, pipeline/PR-n) ── ref_link(pr → job)
tracked_ref(jira, PROJ-88)?         ── ref_link(pr → story)   (optional)
```

- **Uniqueness**: `unique(widget_path, plugin_id, ref_key)` (migration 0001). A pull request
  appears once per widget (FR-006), and so does a job. A story can be linked to several rows'
  pull requests.
- **Exactly one job per row**: `setJob` replaces the pull request's existing job link.
- **Removing a row**: removes the pull request plus every linked reference that ends up with no
  links (cascade). A story still linked to another row is kept.
- **Dismissed story suggestions**: stored as plugin state under the `delivery` namespace, with the
  key `dismissed:<widgetPath>:<prKey>` and the value `string[]` (the dismissed story keys). This is
  plugin state, not item content. `onData` deletes dismissal keys for PRs that are no longer
  tracked in the widget. `removeRow` deletes the row's key. Keys left by widgets that are removed from
  config are not cleaned up yet, because `ctx` has no list of configured widgets. They are a few bytes
  each, and their cleanup is deferred.

### Row state (derived from live data, never stored)

```text
active ──(PR state MERGED or CLOSED)──▶ done ──(closedAt/mergedAt + retention < now)──▶ removed
  ▲                                       │
  └────────────(PR reopened)──────────────┘
```

- **Retention**: `retention` is a setting of the tracker widget, a duration defaulting to `7d`.
- **Removal**: the delivery plugin's `onData` hook removes rows past retention through
  `ctx.widget.untrack(..., { cascade: true })`, and logs `delivery.row.expired`.

### Attention ordering (FR-026)

A row's attention rank is:

- **0**: its build failed or is unstable, its review decision is `CHANGES_REQUESTED`, or its check
  rollup is `FAILURE` or `ERROR`;
- **1**: its build is running;
- **2**: anything else.

Rows are sorted by rank, then by the most recent `updatedAt` or build timestamp. Groups are sorted
by the lowest rank of their rows, then by repository name.

## Live data (never stored)

### Jira item `data`

| Field | Type |
|-------|------|
| key, url | string |
| title | string (the issue summary) |
| status | string (for example "In Review") |
| category | `"todo"` \| `"inprogress"` \| `"done"` |
| assignee | string \| null |

### GitHub item `data`

| Field | Type |
|-------|------|
| repo, number, url, title, author, branch | string, number |
| state | `"draft"` \| `"open"` \| `"merged"` \| `"closed"` |
| review | `"approved"` \| `"changes_requested"` \| `"review_required"` \| null |
| checks | `"success"` \| `"failure"` \| `"pending"` \| `"error"` \| null |
| updatedAt, mergedAt, closedAt | ISO string \| null |

### Jenkins item `data`

| Field | Type |
|-------|------|
| pipeline, job, url | string |
| exists | boolean. `false` when the job is not in the pipeline (not created yet, or deleted). The UI shows "waiting for first build" while the PR is open, and "job no longer exists" once it is merged or closed. |
| build | `{ number, url, result: "success"\|"failure"\|"unstable"\|"aborted"\|"not_built"\|null, building: boolean, startedAt: epoch ms, durationMs, estimatedDurationMs }` \| null (no build yet) |
| main | `{ branch, lastSuccessAt: epoch ms \| null, url \| null }` for the pipeline's main-branch job |

## Composite widget data (pushed to the browser)

This extends the host's `WidgetData` (see [contracts/plugin-api-1.1.md](./contracts/plugin-api-1.1.md)):

```ts
type CompositeWidgetData = WidgetData & {
  items: Array<{ plugin: string; id: number; refKey: string; ref: unknown; data?: unknown; error?: string }>;
  links: Array<{ from: number; to: number }>;   // tracked_ref ids
  meta?: { dismissed: Record<string, string[]> }; // from delivery.onData
};
```

The per-plugin freshness of each item (`state`, `lastSuccessAt`) is carried per item, so a stale
Jenkins cell can sit next to a fresh GitHub cell (FR-020).

## Configuration (YAML, validated by the plugins' settings schemas)

See [contracts/plugins.md](./contracts/plugins.md) for each plugin's full settings. In summary:

| Plugin | Settings |
|--------|----------|
| `jira` | `deployment` (`cloud` \| `datacenter`), `baseUrl`, `email` (cloud only), `token: {env}`, `projectKeys: string[]` (used for story suggestions) |
| `github` | `apiUrl` (default `https://api.github.com/graphql`), `webUrl` (default `https://github.com`), `token: {env}`, `defaultRepo?` |
| `jenkins` | `baseUrl`, `user`, `token: {env}`, `pipelines: { "owner/name": "folder/pipeline" }`, `pipelineTemplate` (default `{name}`), `mainBranch` (default `main`), `runningRefreshInterval` (default `10s`) |
| `delivery` (widget settings) | `retention` (default `7d`), `storyProjects?` (defaults to the Jira plugin's `projectKeys`) |

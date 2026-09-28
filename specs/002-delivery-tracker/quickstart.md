# Quickstart: Validate the Delivery Tracker

Everything below runs in **mock mode**, apart from §6, which uses local fake source servers. It
builds on the [001 quickstart](../001-dashboard-host/quickstart.md). The contracts are in
[contracts/](./contracts/) and the data shapes in [data-model.md](./data-model.md).

## 1. Build and start

```bash
pnpm install && pnpm build
pnpm start -- --config examples/config --plugins plugins --db .data/delivery-mock.db --mock
pnpm seed:delivery            # adds sample rows through the actions API of the running instance
```

Open http://localhost:4400/#/delivery.

| Check | Expected result | Covers |
|-------|-----------------|--------|
| Tracker rows | Rows are grouped by repository. Each group header shows the main branch's last successful build ("2 h ago", with the exact time on hover). Rows show story, pull request and build cells with text labels. | US1, US2, FR-026 |
| Standalone widgets | The Stories, Pull requests and Builds widgets each list their own tracked items | US4 |
| Attention order | Rows with a failed build or changes requested come first in their group | FR-026 |
| Running build | The progress bar advances every second, and the status is refreshed about every 10 s (see `refresh.cycle` logs for `jenkins`) | FR-013, FR-032 |

## 2. Add rows and infer the missing half (US1)

In the tracker, choose **Add** and try each of these:

| Input | Expected result |
|-------|-----------------|
| PR `acme/web#1423` only | A row appears with job `acme/web/PR-1423` inferred, and a suggested story `PROJ-65` (1423 mod 97) with **Link** and **Dismiss** |
| Job `acme/web/PR-77` only | A row appears with PR `acme/web#77` inferred |
| PR `acme/web#5` and job `acme/web/PR-6` | Inline error: the job builds a different pull request |
| PR `acme/web#1423` again | Inline error: already tracked |
| PR `acme/web#9` with the Jenkins scenario `noJob: ["acme/web/PR-9"]` | Row is added, and the build cell shows "waiting for first build" |
| PR `acme/zzz#1` with the Jenkins scenario `unknownPipelines: ["acme/zzz"]` | Inline error: no Jenkins pipeline; enter the job by hand |

Then use the row menu to link the suggestion, remove the story, re-infer the job, and remove the
row. Each change appears straight away.

## 3. Batching (US3, SC-002)

```bash
pnpm seed:delivery -- --rows 30 --repos 3
```

Expected: the `refresh.cycle` logs per refresh show `github requests: 1`, `jira requests: 1`, and
`jenkins requests: 3`. With three browser tabs open, the counts are the same.

## 4. Done section and retention (FR-021)

Set `plugins.github.mock.scenario` to `{ merged: ["acme/web#1423"], mergedAgoDays: { "acme/web#77": 8 } }`.

Expected: `#1423` moves to the collapsed **Done** section. `#77` is removed, and the log shows
`delivery.row.expired`.

## 5. Isolation (FR-020, SC-005)

Set `plugins.jenkins.mock.latencyMs: 20000` and `plugins.jenkins.timeout: 1s`.

Expected: only the build cells show timeout or stale states, and the story and pull request cells
keep updating.

## 6. Real source adapters against fake servers

```bash
pnpm test --project contract delivery   # starts node:http fakes for Jira, GitHub and Jenkins
```

Expected, for both Jira Cloud and Jira Data Center:

- Each source gets one request per refresh, with the right authentication header.
- Missing items become per-cell "not found or no access" errors.
- A GitHub 429 leads to stale cells and a back-off.
- No token appears in any log or response.

## 7. Everything

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm size && pnpm perf:coldstart
OPSDASH_CHROMIUM=/usr/bin/chromium pnpm test:e2e     # includes the delivery dashboard with axe
```

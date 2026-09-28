# Feature Specification: Delivery Tracker (Jira, GitHub and Jenkins plugins)

**Feature Branch**: `002-delivery-tracker`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "build out 3 plugins: 1. Jira: fetching stories, their status 2. Github: pull requests, status 3. Jenkins: jobs, current status PR branch status/progress, last succesful main build datetime. These 3 items should be tracked together on the dashboard for instance in a table row. The user will add an optional jira story, mandatory github PR and mandatory build job. Job and PR could be inferred from one another. The PR should always have a build job through jenkins hooks and the jenkins build obviously has a reference back to the github PR. Then build out the dashboard that integrates these data points."

## Overview

This feature adds three source-system plugins (Jira, GitHub and Jenkins) and a **delivery tracker**
widget that brings them together. Each row of the tracker follows one change on its way to delivery.
A row holds:

- a **pull request** (required);
- the **Jenkins build job** for that pull request (required, but it can be inferred from the pull
  request, and the pull request can be inferred from it);
- an optional **Jira story**.

The row shows each item's live status side by side. All data is queried live from the source systems
with as few requests as possible. Only identifiers and the links between them are stored
(constitution: Plugin Data Pattern).

The primary actor is the **operator**, the person who configures Opsdash and tracks items in the UI.
The secondary actor is the **viewer**, anyone who looks at the dashboard.

## Clarifications

### Session 2026-09-28

- Q: Which deployments must the Jira and GitHub plugins support? → A: Cloud and self-hosted:
  Jira Cloud and Jira Data Center/Server; GitHub.com and GitHub Enterprise Server. Jenkins is
  self-hosted.
- Q: What happens to a row after its pull request is merged or closed? → A: It moves to a
  collapsed "Done" section and is removed automatically after a configurable period (default
  7 days).
- Q: Should Opsdash look for a story key in the pull request's title or branch name? → A: Yes.
  A key found there is shown as a suggestion, and the operator confirms it with one click.
- Q: Can one pull request have more than one Jenkins build job? → A: No. Each repository maps
  to one pipeline, and each row has exactly one build job.
- Q: How fresh should build progress be while a build is running? → A: Jenkins refreshes every
  10 s while any visible tracked build is running, and at the normal interval (60 s) otherwise.
- Q: How are rows from several repositories arranged? → A: Grouped under a header per repository.
  The header shows that repository's main-branch last successful build once.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Track a change as one row (Priority: P1)

The operator opens the delivery tracker and adds a row by entering a pull request (for example
`acme/web#1423` or its URL). Opsdash finds the pull request's Jenkins build job on its own and adds
it to the same row. The operator can also add the Jira story the change belongs to. The row then
shows the story's status, the pull request's status and the build's status next to each other.

**Why this priority**: This is the core value of the feature: seeing where one change stands across
three tools in a single place.

**Independent Test**: In mock mode, add a row with only a pull request. The row shows the pull
request and its inferred build job with live status and an empty story cell. Add a story to the row
and its status appears.

**Acceptance Scenarios**:

1. **Given** the tracker widget, **When** the operator adds a row with pull request `acme/web#1423`
   and no other input, **Then** a row appears containing that pull request and its build job
   (inferred), and the story cell offers to add a story.
2. **Given** a row, **When** the operator adds Jira story `PROJ-88`, **Then** the story's key,
   title and status appear in the row.
3. **Given** the tracker widget, **When** the operator adds a row by entering a build job instead of
   a pull request, **Then** Opsdash infers the pull request from the job and the row contains both.
4. **Given** the operator enters both a pull request and a build job that belong to different
   changes, **When** the row is submitted, **Then** it is rejected with a message explaining that
   the job builds a different pull request.
5. **Given** a pull request whose repository has no Jenkins pipeline, **When** the row is
   submitted, **Then** the operator is told no pipeline was found and can enter the job by hand.
   The row is not added without a build job. If the pipeline exists but the pull request's job
   hasn't been created yet, the row is added and the build cell shows "waiting for first build".
6. **Given** a row, **When** the operator removes it, **Then** the row and its links disappear, and
   nothing is fetched for it any more.
7. **Given** a row, **When** the operator removes only its story, **Then** the pull request and the
   build job stay in the row.
8. **Given** a pull request that is already tracked in this widget, **When** the operator adds it
   again, **Then** no duplicate row is created and the operator is told it is already tracked.
9. **Given** a row without a story whose pull request title or branch contains `PROJ-88`, **When**
   the row is shown, **Then** the story cell suggests `PROJ-88` with a "Link" action. Choosing it
   links the story. Dismissing it hides the suggestion for that row.
10. **Given** a row whose pull request was merged, **When** the dashboard refreshes, **Then** the
    row moves to the collapsed "Done" section. Seven days after the merge (the default), it is
    removed together with its links.

---

### User Story 2 - See live status for every item in a row (Priority: P1)

For each row, the viewer sees:

- **Jira story**: key, title, status, and assignee.
- **Pull request**: repository and number, title, author, state (draft, open, merged or closed),
  review decision (approved, changes requested or review required), and the combined result of its
  checks.
- **Build job**: the latest build of the pull request's branch with its result (success, failure,
  unstable or aborted), or, while a build is running, its progress as an estimated percentage and
  time remaining.
- **Repository group header**: the date and time of the **last successful build of the main
  branch** for that repository.

Every value links to the item in its own tool.

**Why this priority**: Without live status the rows are just a list of links.

**Independent Test**: In mock mode, configure faults so that one build is running, one failed and one
succeeded. Each row shows the matching state, the progress of the running build, and the main
branch's last successful build time.

**Acceptance Scenarios**:

1. **Given** a row whose pull request build is running, **When** the dashboard refreshes, **Then**
   the build cell shows "running" with an estimated percentage complete and the estimated time
   remaining.
2. **Given** a row whose pull request build failed, **When** the dashboard refreshes, **Then** the
   build cell shows "failed" and when it finished.
3. **Given** a repository whose main branch last built successfully two hours ago, **When** the
   dashboard shows rows for that repository, **Then** the repository's group header shows that
   time once ("2 h ago", with the exact date and time on hover or focus).
4. **Given** a pull request that was merged, **When** the dashboard refreshes, **Then** the pull
   request cell shows "merged".
5. **Given** a row, **When** the viewer activates the story, pull request or build value, **Then**
   the item opens in its own tool.
6. **Given** one source system is unreachable, **When** the dashboard refreshes, **Then** only that
   system's cells show an error or stale state, and the other cells keep updating.

---

### User Story 3 - Status with the fewest possible requests (Priority: P1)

However many rows are tracked, each refresh asks each source system for all of its items together:
one request per Jira site, one per GitHub host, and one per Jenkins pipeline. It does not send one
request per row.

**Why this priority**: The constitution makes minimizing requests a major objective, and source
systems enforce rate limits.

**Independent Test**: In mock mode, track 30 rows across 3 repositories. Count the mock requests per
refresh: 1 for Jira, 1 for GitHub, and 1 per Jenkins pipeline (3).

**Acceptance Scenarios**:

1. **Given** 30 rows referencing 30 stories, **When** a refresh runs, **Then** Jira receives one
   request for all 30 stories.
2. **Given** 30 rows referencing pull requests in 3 repositories on one GitHub host, **When** a
   refresh runs, **Then** GitHub receives one request for all 30 pull requests.
3. **Given** 30 rows whose jobs belong to 3 Jenkins pipelines, **When** a refresh runs, **Then**
   Jenkins receives at most one request per pipeline. That request also covers the main branch's
   last successful build.
4. **Given** two widgets that track the same pull request, **When** a refresh runs, **Then** that
   pull request is requested once.

---

### User Story 4 - Use each plugin on its own (Priority: P2)

Each plugin also provides a simple list widget of its own: tracked Jira stories, tracked pull
requests, or tracked build jobs. Each can be placed on a dashboard independently of the tracker.

**Why this priority**: Operators often need just one view, such as a build board, and the plugins
must follow the host's contract on their own.

**Independent Test**: Place only the Jenkins widget on a dashboard, track two jobs, and see their
status.

**Acceptance Scenarios**:

1. **Given** a dashboard with only the Jira widget, **When** the operator tracks `PROJ-88`, **Then**
   the story and its status appear.
2. **Given** a dashboard with only the GitHub widget, **When** the operator tracks a pull request,
   **Then** it appears with its state, review decision and checks.
3. **Given** a dashboard with only the Jenkins widget, **When** the operator tracks a job, **Then**
   it appears with its latest build status and the main branch's last successful build time.

---

### User Story 5 - Ready-made delivery dashboard (Priority: P2)

Opsdash ships an example "Delivery" dashboard, configured in YAML, that combines the tracker with the
individual widgets. It works out of the box in mock mode and against real systems once the site
addresses and credentials are provided.

**Why this priority**: It shows the finished experience and gives operators a starting point.

**Independent Test**: Start Opsdash in mock mode with the example config and open the Delivery
dashboard. It renders the tracker with sample rows and the individual widgets, with no errors.

**Acceptance Scenarios**:

1. **Given** mock mode and the example config, **When** the Delivery dashboard opens, **Then** the
   tracker shows its sample rows with statuses from all three tools.
2. **Given** the example config with real site addresses and environment variables set, **When**
   Opsdash starts outside mock mode, **Then** the same dashboard shows live data.
3. **Given** a required environment variable is missing, **When** Opsdash starts outside mock mode,
   **Then** the affected plugin reports which variable is missing, and the other plugins keep
   working.

---

### Edge Cases

- A pull request is merged or closed. The row moves to "Done" and is removed after the retention
  period (FR-021). If the pull request is reopened before that, the row moves back to the active
  list.
- The pull request title and the branch name contain different story keys. Both are suggested,
  title first.
- A pull request has no build yet (just opened, webhook still pending), or its job doesn't exist
  in the pipeline yet. The row can still be added: the job name follows the pipeline's naming
  convention, and the build cell shows "waiting for first build" while the pull request is open.
- A pull request's build job was deleted in Jenkins (for example the branch was cleaned up after the
  merge). While the pull request is merged or closed, the build cell shows "job no longer exists",
  and the row is kept.
- The main branch has never built successfully. The cell shows "no successful build".
- A pull request or story is not found, or the credentials can't see it. That cell shows "not found
  or no access", and the rest of the row renders.
- The pull request moves to a new build job (for example after the pipeline is renamed). Inference
  runs when a row is created. Afterwards the operator can re-infer or edit the job for that row.
- A story is linked to several rows (one story, several pull requests). This is allowed. Each row
  shows the same story.
- Pull requests from many repositories map to different Jenkins pipelines. Each repository's
  pipeline comes from configuration, and each repository has exactly one pipeline. Repositories
  built by several pipelines are out of scope for this feature.
- Source rate limit reached. The refresh backs off, cells show stale data with the last success
  time, and nothing is retried per item.
- A very long build (hours). Progress is shown against the estimate. When the build runs past its
  estimate, the cell shows "running, over estimate" instead of more than 100%.

## Requirements *(mandatory)*

### Functional Requirements

**Tracker rows**

- **FR-001**: The tracker widget MUST show one row per tracked change, with three cells: Jira story
  (optional), pull request (required) and build job (required).
- **FR-002**: The operator MUST be able to add a row by entering either a pull request or a build
  job, plus an optional story. Accepted input is a key, a short reference such as `acme/web#1423`, or
  the item's URL.
- **FR-003**: When only one of pull request or build job is entered, the system MUST infer the
  other: the job from the pull request (through the repository's configured pipeline) and the pull
  request from the job (through the build's reference to its pull request).
- **FR-004**: The system MUST reject a row whose pull request and build job refer to different
  changes, and MUST reject a row whose missing half cannot be inferred (for example, the repository
  has no Jenkins pipeline). In both cases it explains why, and the operator can enter the missing
  item by hand. A job that doesn't exist yet in an existing pipeline is not a reason to reject the
  row (see Edge Cases).
- **FR-005**: The operator MUST be able to add, change or remove a row's story, re-run inference or
  edit the row's build job, and remove a whole row. Removing a row removes its links.
- **FR-006**: A pull request MUST appear at most once per tracker widget.
- **FR-007**: Rows MUST be persisted as item identifiers and the links between them only (story ↔
  pull request ↔ build job). Titles, statuses and other content MUST NOT be stored.
- **FR-008**: Rows belong to their widget instance, following the host's per-widget tracking rules
  (the same change can be tracked in several widgets).

**Jira**

- **FR-009**: The Jira plugin MUST show, for each story: key, title, status (with its status
  category: to do, in progress or done), assignee, and a link to the story.
- **FR-010**: The Jira plugin MUST fetch all tracked stories of one Jira site in a single request
  per refresh.

**GitHub**

- **FR-011**: The GitHub plugin MUST show, for each pull request: repository, number, title,
  author, state (draft, open, merged or closed), review decision, the combined result of its checks,
  and a link.
- **FR-012**: The GitHub plugin MUST fetch all tracked pull requests of one GitHub host in a single
  request per refresh, across repositories.

**Jenkins**

- **FR-013**: The Jenkins plugin MUST show, for each tracked build job: the latest build's number,
  result (success, failure, unstable, aborted or not built) and finish time. While a build is
  running, it MUST show "running" with an estimated percentage and time remaining, based on the
  estimated duration.
- **FR-014**: The Jenkins plugin MUST show the date and time of the last successful build of the
  repository's main branch (the branch name is configurable, default `main`).
- **FR-015**: The Jenkins plugin MUST fetch a pipeline's pull request jobs and its main branch job
  in a single request per pipeline per refresh.
- **FR-016**: The Jenkins plugin MUST be able to identify the pull request that a job or build
  belongs to, and the job that belongs to a pull request, so that FR-003 works in both directions.

**All three plugins**

- **FR-017**: Each plugin MUST follow the host's plugin contract, including a mock source with
  realistic data and fault injection, and credentials supplied only through environment variables.
- **FR-018**: The plugins MUST support Jira Cloud and Jira Data Center/Server, GitHub.com and
  GitHub Enterprise Server, and self-hosted Jenkins. The site address and deployment type are set in
  config, and each deployment's credential style is supported: Jira Cloud uses an email plus API
  token, Jira Data Center uses a personal access token, GitHub uses a token, and Jenkins uses a user
  plus API token. All credentials come from environment variables.
- **FR-019**: Each plugin MUST provide its own list widget, usable without the tracker (US4).
- **FR-020**: A failure, timeout or rate limit in one source system MUST affect only the cells from
  that system. Other cells and widgets keep updating.

**Lifecycle and linking**

- **FR-021**: When a row's pull request is merged or closed, the row MUST move to a collapsed
  "Done" section below the active rows. It is removed automatically, with its links, once the merge
  or close time is older than the retention period (configurable, default 7 days). A reopened pull
  request moves back to the active rows. Removal affects only Opsdash's stored identifiers, never the
  source systems.
- **FR-022**: When a row has no story, the system MUST look for story keys (in the configured Jira
  project key format) in the pull request's title, then its branch name. Any key found is shown as a
  suggestion that the operator links with one action or dismisses. Nothing is linked without the
  operator's confirmation, and a dismissal is remembered for that row.

**Presentation**

- **FR-023**: Every status MUST be shown with a text label as well as a colour, so it doesn't
  depend on colour alone. Relative times MUST show the exact date and time on hover or focus.
- **FR-024**: Every story, pull request and build value MUST link to the item in its own tool,
  opening in a new tab.
- **FR-025**: The tracker MUST stay readable from 360 px wide, with each row collapsing into a
  stacked card on narrow screens, up to wall-display widths.
- **FR-026**: The tracker MUST group rows under a header per repository. The header shows the
  repository name and its main branch's last successful build time (FR-014), shown once rather than
  per row. Groups needing attention come first. Within a group, rows needing attention (a failed
  build, changes requested, or a failing check) come first, then running builds, then the rest by
  most recent activity. The Done section (FR-021) sits below all groups.

**Host capabilities needed**

- **FR-027**: The host MUST let one widget show items owned by several plugins. Each item is
  fetched by its own plugin within that plugin's normal batched refresh, so the tracker adds no
  requests of its own.
- **FR-028**: The host MUST let a plugin ask another plugin to resolve an input into a reference
  through the host (for example the tracker asking Jenkins for the job of a pull request), without
  depending on that plugin's internals.
- **FR-029**: These host additions MUST be backward compatible with plugin API 1.x (a MINOR version
  bump), and the reference plugin and its tests keep passing unchanged. A composite plugin (one
  with no source of its own, like the tracker) is exempt from the host's mock-source requirement
  (001 FR-049), because it has nothing to mock. Its manifest must still declare its settings
  schema.
- **FR-032**: While at least one visible tracked build is running, the Jenkins plugin MUST refresh
  at a faster interval (configurable, default 10 s). It returns to its normal interval once none is
  running. Each faster refresh is still one request per pipeline. The host MUST let a plugin
  request this temporary interval without overlapping refreshes (host FR-026 still applies).

**Configuration**

- **FR-030**: Config MUST let the operator set, per plugin: the site address; the environment
  variable names of its credentials; for Jenkins, the mapping from each repository to its pipeline
  (defaulting to a pipeline named after the repository) and the main branch name; and the refresh
  interval.
- **FR-031**: Opsdash MUST ship an example Delivery dashboard (US5) that works in mock mode without
  credentials.

### Key Entities

- **Jira Story Reference**: a site and an issue key (for example `PROJ-88`). Persisted.
- **Pull Request Reference**: a GitHub host, a repository (`owner/name`) and a number. Persisted.
- **Build Job Reference**: a Jenkins site, a pipeline path and a job name (for example the pull
  request's branch job `PR-1423`). Persisted.
- **Tracker Row**: a pull request reference and a build job reference (both required), plus an
  optional story reference, connected by links and owned by one tracker widget. It is either active,
  or done (the pull request is merged or closed, and it is removed after the retention period). Only
  the references, links and dismissed story suggestions are persisted.
- **Repository → Pipeline Mapping**: configuration that says which single Jenkins pipeline builds
  each repository (one pipeline per repository), and which branch is the main branch.
- **Live status** (never persisted): the story status, the pull request state, review decision and
  checks, the build result or progress, and the main branch's last successful build time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can add a tracked change by entering only a pull request (or only a build
  job) in under 20 seconds, with the other half inferred correctly in 100% of the mock test cases.
- **SC-002**: With 30 rows across 3 repositories, one refresh sends exactly 1 request to Jira, 1 to
  GitHub, and 3 to Jenkins (one per pipeline). The count is the same with 1 viewer and with 10.
- **SC-003**: A tracker with 30 rows shows every cell's final state within 2 seconds of opening, in
  mock mode.
- **SC-004**: A viewer can tell from the dashboard alone, without opening any other tool, whether a
  change is blocked (build failed, changes requested, or checks failing). In a hallway test, at
  least 9 of 10 viewers answer correctly within 5 seconds per row.
- **SC-005**: When one source system is down, 100% of cells from the other two systems keep
  updating on schedule.
- **SC-006**: While builds are running, their progress and any status change (for example running
  to failed) appear on the dashboard within 10 seconds. When no builds are running, changes appear
  within 60 seconds.
- **SC-007**: A search of the store, config, logs and browser-visible output finds zero credential
  values (the host's secret scan, extended to the three plugins).
- **SC-008**: The Delivery dashboard passes WCAG 2.2 AA checks in light and dark themes, and has no
  horizontal scrolling from 360 px to 3840 px wide.

## Assumptions

- Jenkins builds pull requests with a multibranch pipeline for each repository. Pull request jobs
  are named `PR-<number>`, and the main branch has its own job. GitHub webhooks trigger Jenkins, as
  the user described, so every pull request gets a build job.
- A Jenkins build knows its pull request (number and repository), which makes job → pull request
  inference possible without extra configuration.
- "Main build" means the latest successful build of the main-branch job in the same pipeline as
  the pull request.
- Credentials are read-only tokens (Jira API token, GitHub token with read access to pull requests
  and checks, Jenkins user token). No plugin changes anything in the source systems (constitution:
  read-only by default).
- The default refresh interval for all three plugins is 60 seconds, the same as the host default.
  Jenkins switches to 10 seconds while a visible tracked build is running (FR-032).
- Tracker rows follow the host's existing rules: they are stored per widget, and rows of a widget
  that is removed from a valid config are deleted.
- Webhooks, or any push from the source systems into Opsdash, are out of scope. Opsdash only polls.
- One Jira site, one GitHub host and one Jenkins site per plugin configuration are enough. Several
  instances of one tool can be supported later through separate plugin configurations or
  `batchKey`.

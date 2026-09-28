# Implementation Plan: Delivery Tracker (Jira, GitHub and Jenkins plugins)

**Branch**: `002-delivery-tracker` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-delivery-tracker/spec.md`

## Summary

This feature adds three source plugins and one composite plugin:

- `jira` fetches stories in one bulk request per site (Cloud through bulkfetch, Data Center
  through JQL search).
- `github` fetches pull requests in one aliased GraphQL request per host.
- `jenkins` fetches each pipeline's branch jobs and its main branch's last successful build in one
  `tree` request per pipeline. It also offers two resolvers that infer a job from a pull request
  and back.
- `delivery` is the composite tracker. Its rows are tracked references linked across the three
  plugins, grouped by repository and ordered by attention, with a Done section and retention.

To support these without breaking plugin API 1.0, the host gains **plugin API 1.1**, a set of
purely additive changes:

- composite widgets;
- widget actions;
- resolvers that one plugin can call on another through the host;
- per-reference `batchKey`;
- `ctx.scheduleNext`, for faster refreshes while builds run and for rate-limit back-off.

It also needs one store migration. The design decisions are in [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5+ (TypeScript 7 toolchain) on Node.js 24, the same as 001.

**Primary Dependencies**: None new. The plugins use Node's built-in `fetch`. The tracker's cell
renderers come from a new workspace package, `@opsdash/delivery-cells`, which each plugin bundles
at build time.

**Storage**: SQLite through Drizzle. Migration `0001` changes uniqueness to
`(widget_path, plugin_id, ref_key)`.

**Testing**:

- Vitest:
  - plugin contract tests for all four plugins in mock mode;
  - real sources tested against in-process `node:http` fakes;
  - host tests for API 1.1 (composite fetching, actions, resolvers, `scheduleNext`) and the
    migration.
- Playwright with axe, covering the delivery dashboard.

**Target Platform**: The same as 001.

**Project Type**: Four new plugin packages plus host and SDK changes, in the existing pnpm
workspace.

**Performance Goals**:

- 30 rows reach their final state within 2 s (SC-003).
- One request per source per refresh, or one per pipeline for Jenkins (SC-002).
- Status changes appear within 10 s while builds run (SC-006).

**Constraints**:

- Each plugin client bundle is at most 15 KB gzipped (the tracker at most 20 KB).
- The host's existing budgets are unchanged: web JavaScript at most 60 KB, cold start at most
  1.5 s, idle memory at most 150 MB.

**Scale/Scope**: About 30 to 100 rows per tracker, a few repositories and pipelines, and one site
per tool.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Rule | How this plan complies | Status |
|------|------------------------|--------|
| **I. Plugin-first**: no widget logic in the core; the public API only | The tracker is a plugin (`delivery`). The host additions (composite, actions, resolvers, `scheduleNext`) are generic and have no knowledge of the tracker. Built-in plugins use only the SDK. | ✅ |
| **II. File-based config**: no UI editors | Sites, pipeline mappings and retention are all set in YAML. The UI's add, link and remove controls are data entry on tracked items, which host FR-012 allows. | ✅ |
| **III. Read-only by default and no stored credentials** | Every source call is a read (GET, search, GraphQL query). Actions change only Opsdash's own store. Tokens come from env through `secret()` and are redacted by the SDK helper and the host. | ✅ |
| **IV. YAGNI, don't reinvent the wheel** | No new dependencies. Built-in `fetch` is enough for REST and GraphQL POSTs. Features are limited to one site per tool, one pipeline per repository, and polling only. | ✅ |
| **V. Minimalist UI** | Tokens only, text labels as well as colour, container-query cards on narrow widths, and axe checks on the delivery dashboard. | ✅ |
| **Plugin data pattern**: store references only; link through the host; query live; batch every fetch; host-coordinated fetching | Rows are references plus host links. Live data is never stored. Jira and GitHub make one call per site; Jenkins makes one call per pipeline. The composite widget adds no fetches, because the host routes its references to their owning plugins' batches. | ✅ |
| **Storage and plugin contract**: versioned API; migrations; namespaced state | API 1.1.0 is a MINOR, additive release, and existing `^1.0.0` plugins are unchanged (FR-029). Migration 0001 comes with a migration test. Dismissed suggestions live in `delivery`'s own state namespace. | ✅ |
| **Quality gates**: contract tests for plugin API and config changes; migration tests | Contract tests cover API 1.1 against the reference plugin (unchanged) and the four new plugins. There is a migration test for 0001. The example config is extended and covered by the reference-config snapshot. | ✅ |

**Post-design re-check**: ✅ All gates still pass.

**N+1 check**: Jenkins' `jobForPullRequest` makes one existence request, and only when a row is
added. It never runs during refresh cycles. Nothing loops per item during refresh.

## Project Structure

### Documentation (this feature)

```text
specs/002-delivery-tracker/
├── plan.md, research.md, data-model.md, quickstart.md
├── contracts/
│   ├── plugin-api-1.1.md     # host/SDK additions
│   ├── plugins.md            # jira, github, jenkins, delivery contracts
│   ├── http-api.md           # actions route, untrack params
│   └── config-example.md     # delivery dashboard YAML
└── tasks.md                  # /speckit-tasks
```

### Source Code (repository root)

```text
packages/plugin-sdk/src/
├── types.ts              # + API 1.1 types (actions, resolvers, composes, scheduleNext, ActionContext)
├── http.ts               # NEW sourceRequest / SourceError / ResolverError
└── client/index.ts       # + actions, links, meta, items[].plugin/id, itemState
packages/host/src/
├── plugins/manifest.ts   # composes, "actions" capability, relaxed requirements for composites
├── plugins/context.ts    # scheduleNext, plugins.parse/resolve, widget (ActionContext)
├── refresh/plan.ts       # per-ref batchKey; foreign needs from composite widgets
├── refresh/scheduler.ts  # setTimeout chain + scheduleNext; composite assembly + onData
├── http/actions.ts       # NEW POST /api/widgets/:path/actions/:name
├── http/tracking.ts      # plugin + cascade on untrack; plugin/id in listing
├── config/schema.ts      # mock.scenario
└── store/{schema,repos}.ts + drizzle/0001_*.sql
packages/delivery-cells/  # NEW shared cell renderers (bundled into plugin clients)
plugins/
├── jira/      src/{server,source,mock,client}.ts(x)
├── github/    src/{server,source,query,mock,client}.ts(x)
├── jenkins/   src/{server,source,resolvers,mock,client}.ts(x)
└── delivery/  src/{server,actions,rows,client}.ts(x) + tracker.module.css
examples/config/dashboards/delivery.yaml   # + plugin entries in opsdash.yaml
scripts/seed-delivery.mjs                  # sample rows via the actions API
tests/
├── contract/delivery/                     # per-plugin contracts + fake servers
│   ├── fakes.ts                           # node:http Jira/GitHub/Jenkins fakes
│   └── {jira,github,jenkins,delivery,api-1.1}.test.ts
└── e2e/delivery-{rows,standalone,perf}.spec.ts + a11y.spec.ts (delivery added)
```

**Structure Decision**: Each tool is its own plugin package, so each can be installed and versioned
separately. Shared presentation lives in a package that is bundled at build time, so there is no
runtime coupling between plugins. Host changes stay inside the existing modules.

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
|----------|------------|--------------------------------------|
| Composite plugins (host routes a widget's foreign references to their owning plugins) | A single row shows data from three plugins (FR-027) | A tracker that fetches through the other plugins would bypass host batching and de-duplication. A tracker in the core would break Principle I. |
| Widget actions | A row is several linked references, with editing, dismissal and retention | Structured payloads on the track route would become special cases per plugin |
| Resolvers across plugins | Inferring a job from a PR is Jenkins knowledge that the tracker needs (FR-028) | Putting inference in the tracker would copy Jenkins' configuration and credentials into another plugin |
| `ctx.scheduleNext` | Refreshing every 10 s while builds run (FR-032), and rate-limit back-off | A fixed fast interval would multiply Jenkins load by 4 while idle |

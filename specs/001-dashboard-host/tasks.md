---

description: "Task list for Core Dashboard Host"
---

# Tasks: Core Dashboard Host

**Input**: Design documents from `specs/001-dashboard-host/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (config-format,
plugin-api, http-api), quickstart.md

**Tests**: These are included because the spec and constitution require them. The spec
requires contract tests (FR-044), an invalid-config set (SC-002), a secret scan (SC-009),
and WCAG checks (SC-010). The constitution's quality gates require migration tests. Every
test runs in **mock mode**.

**Organization**: Tasks are grouped by user story. Each story phase can be tested on its own
once Phase 2 is done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 to US8, from spec.md

## Path Conventions

This is a pnpm workspace (see plan.md → Project Structure). The paths used are
`packages/host/src/`, `packages/web/src/`, `packages/plugin-sdk/src/`, `plugins/reference/`,
`examples/config/`, and `tests/{contract,e2e,fixtures}/`. Each package's own unit and
integration tests live in `packages/*/tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Workspace, tooling, and dev hot-reload scaffolding

- [X] T001 Create root workspace files: `package.json` (private; scripts `dev`, `build`, `start`, `test`, `test:e2e`, `test:config-errors`, `test:secret-scan`, `typecheck`, `size`), `pnpm-workspace.yaml` (packages: `packages/*`, `plugins/*`), `.nvmrc` = `24`, and `.gitignore` (node_modules, dist, .data, .env)
- [X] T002 Create `tsconfig.base.json` with `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `module`/`moduleResolution` = `nodenext`, `jsx: react-jsx`, `jsxImportSource: preact`, and add per-package `tsconfig.json` files extending it in `packages/host`, `packages/web`, `packages/plugin-sdk`, and `plugins/reference`
- [X] T003 [P] Scaffold `packages/host/package.json` (name `@opsdash/host`, bin `opsdash` → `src/main.ts`, deps: hono, @hono/node-server, yaml, zod, drizzle-orm, better-sqlite3, chokidar, lru-cache, pino, semver; dev: drizzle-kit, vitest, @types/better-sqlite3, @types/semver) with script `dev` = `node --watch src/main.ts --config ../../examples/config --plugins ../../plugins --db ../../.data/dev.db --mock`
- [X] T004 [P] Scaffold `packages/web` with Vite 7 + Preact 10 + @preact/signals: `package.json`, `vite.config.ts` (preact plugin, `server.proxy` for `/api`, `/plugins`, `/schema`, `/healthz` → `http://localhost:4400`, build output `dist/`), and `index.html` containing an `<script type="importmap">` placeholder for `preact`, `preact/hooks`, `preact/jsx-runtime`, `@preact/signals`, and `@opsdash/plugin-sdk/client` *(Implemented with Vite 8, the current major; the import map lists `preact`, `preact/hooks`, `preact/jsx-runtime`, `@preact/signals`.)*
- [X] T005 [P] Scaffold `packages/plugin-sdk/package.json` (name `@opsdash/plugin-sdk`, exports `.` → `src/index.ts`, `./client` → `src/client/index.ts`, `./vite` → `src/vite.ts`; peer dep zod, preact)
- [X] T006 [P] Scaffold `plugins/reference/package.json` (name `@opsdash/plugin-reference`, version `1.0.0`, `"opsdash"` manifest block exactly as in `contracts/plugin-api.md` §1 with `id: "reference"`, `capabilities: ["track"]`, `env: ["REFERENCE_TOKEN"]`, `refresh: {interval: "60s", timeout: "10s"}`, `maxBatchSize: 100`) and scripts `build` / `dev` = `vite build [--watch]`
- [X] T007 [P] Configure Vitest workspace in `vitest.workspace.ts` (projects: host, web, plugin-sdk, `tests/contract`) and Playwright in `playwright.config.ts` (webServer: `pnpm start -- --config examples/config --plugins plugins --db .data/e2e.db --mock`, port 4400, projects for 360, 1280, and 3840 widths) *(Vitest 5 replaced `vitest.workspace.ts` with `test.projects` in `vitest.config.ts`; Playwright can use a system Chromium through `OPSDASH_CHROMIUM`.)*
- [X] T008 [P] Configure Biome for lint and format in `biome.json`, and size-limit in `.size-limit.json` (web initial JS ≤ 60 KB gz, web CSS ≤ 15 KB gz, `plugins/reference/dist/client.js` ≤ 10 KB gz)
- [X] T009 Wire root `dev` script to `pnpm -r --parallel run dev` so that Vite HMR (web), `node --watch` (host), and `vite build --watch` (plugins) start together, and document it in `README.md` (research R6)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The minimal end-to-end skeleton every story builds on: SDK types, the mock
source, plugin loading on the happy path, a basic config model, the store runner, HTTP/SSE,
logging, and a naive refresh loop.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T010 [P] Define SDK server types in `packages/plugin-sdk/src/types.ts`: `PluginManifest`, `PluginDefinition` (`settings`, `reference`, `refKey`, `batchKey?`, `needs?`, `parseReference`, `fetch`, `mock`), `PluginContext` (`settings`, `secrets.get`, `signal`, `log`, `state`, `refs.find`, `links`, `mock`), `FetchResult = Map<string, {data: unknown} | {error: string}>`, per `contracts/plugin-api.md` §2
- [X] T011 [P] Implement `definePlugin` (an identity function with type inference) and re-export `z` from zod in `packages/plugin-sdk/src/index.ts`
- [X] T012 [P] Implement `createMockSource({generate, parseReference, faults})` in `packages/plugin-sdk/src/mock.ts`. It needs: a seeded RNG per `refKey` (deterministic); fault defaults `{notFound: [], errorKeys: [], omitKeys: [], extraKeys: [], latencyMs: 0, errorRate: 0}`, overridable at call time; partial results; honouring `ctx.signal`; and incrementing `ctx.state` key `__mock.requests` once per `fetch` call (research R11, FR-049)
- [X] T013 [P] Define client SDK types and `defineWidget` in `packages/plugin-sdk/src/client/index.ts`, with props `{items, state, lastSuccessAt, settings, title}` and state union `"loading"|"ok"|"empty"|"error"|"stale"|"timeout"` (contracts/plugin-api.md §4)
- [X] T014 [P] Implement the Vite preset `opsdashPlugin()` in `packages/plugin-sdk/src/vite.ts`: library mode with two entries `src/server.ts` → `dist/server.js` and `src/client.tsx` → `dist/client.js`; client externals `preact`, `preact/hooks`, `preact/jsx-runtime`, `@preact/signals`, `@opsdash/plugin-sdk/client`; CSS Modules with scoped names injected into the JS bundle; after the build, import `dist/server.js` and write `dist/opsdash.manifest.json` = the `package.json` `opsdash` block + `name`, `version`, `settingsSchema` and `referenceSchema` (from `z.toJSONSchema()`), and `hasMock` (contracts/plugin-api.md §1)
- [X] T015 Implement the reference plugin server in `plugins/reference/src/server.ts`: settings `z.object({view: z.enum(["list","compact"]).default("list"), items: z.array(z.string()).default([]), apiToken: secret().optional()})`; reference `z.object({key: z.string().regex(/^[A-Z]+-\d+$/)})`; `refKey = ref.key`; `needs` returns tracked refs plus `settings.items`; `fetch` (non-mock) calls an in-process simulated source in `plugins/reference/src/source.ts`: it requires `ctx.secrets.get("REFERENCE_TOKEN")` to be set (and, when asked for key `LEAK-1`, throws an error whose message contains the token value, so the secret-scan test T088 can prove redaction), serves any list of keys in one call, and counts calls in `ctx.state` `__source.requests`; `mock` built with `createMockSource` generating `{title, status: "open"|"in-progress"|"done", updatedAt}` (depends on T010–T012)
- [X] T016 Implement the reference plugin widget in `plugins/reference/src/client.tsx` and `plugins/reference/src/widget.module.css`: list and compact views, a status dot, and only `var(--od-*)` tokens (depends on T013, T014)
- [X] T017 [P] Implement the pino logger with a child-logger helper in `packages/host/src/log.ts`, with JSON to stdout and a hook point for value redaction (filled in by US7)
- [X] T018 [P] Implement CLI argument parsing in `packages/host/src/main.ts` using `node:util` `parseArgs`: `--config` (dir, required), `--plugins` (dir, required), `--db` (file, default `./.data/opsdash.db`), `--env-file`, `--mock` (or `OPSDASH_MOCK=1`), and `--port` (default 4400)
- [X] T019 [P] Set up Drizzle in `packages/host/drizzle.config.ts` (dialect `sqlite`, schema `src/store/schema.ts`, out `drizzle/`), and implement `openStore(file)` in `packages/host/src/store/db.ts`. It must: create parent dirs; open better-sqlite3 with `journal_mode=WAL` and `foreign_keys=ON`; run `PRAGMA integrity_check` and refuse to start on failure; refuse to start without touching the file when the store's `__drizzle_migrations` has hashes unknown to the bundled `drizzle/meta/_journal.json`; otherwise run `migrate()` (research R7, FR-030, FR-031)
- [X] T020 [P] Implement the duration parser (`"30s"`, `"5m"`, `"1h"` → ms) and the slug regex `^[a-z0-9-]+$` in `packages/host/src/config/primitives.ts`
- [X] T021 Implement the base config Zod schema v1 in `packages/host/src/config/schema.ts`: root `{version: 1, include?, defaults?, theme?, plugins, dashboards, blocks?}`; `Placement` with `id` slug, `at: [col 1–12, row ≥ 1]`, `size: [w ≥ 1, h ≥ 1]`; a widget placement (`plugin`, `title?`, `settings?`) or a block use (`use`, `with?`); `ThemeSpec` `{mode: "light"|"dark"|"system" default "system", tokens?, tokens-light?, tokens-dark?}` with keys limited to the token list in contracts/config-format.md; `PluginConfig {version: semver range, settings?, refreshInterval?, cacheWindow?, timeout?, mock?}` (depends on T020)
- [X] T022 Implement a single-file config loader in `packages/host/src/config/load.ts`: read `opsdash.yaml`, parse with `yaml` `parseDocument` and `LineCounter`, validate with the schema, and return a `ConfigSet` (data-model §A) with `defaults` 60s/30s/10s. When `opsdash.yaml` is missing, return an empty, valid `ConfigSet` (no dashboards), log `{event: "config.missing", dir}`, and don't crash (spec edge case). (depends on T021)
- [X] T023 Implement plugin discovery and loading on the happy path in `packages/host/src/plugins/registry.ts`: scan the `--plugins` dir for subdirs containing `dist/opsdash.manifest.json` and read the manifest from it, dynamic `import()` the `server` entry, validate plugin config settings with the plugin's `settings` schema, and expose `get(id)`, `list()`, and `clientPath(id)` (depends on T010)
- [X] T024 Implement the plugin context factory in `packages/host/src/plugins/context.ts`: `signal` from `AbortSignal.timeout(timeout)`, `log` as a child logger with `{plugin}`, `mock` flag, and stubs for `state`, `refs`, `links`, and `secrets` that throw "not available yet" (filled in by US6 and US7)
- [X] T025 Implement the resolver in `packages/host/src/config/resolve.ts`, which turns a `ConfigSet` into `ResolvedDashboard[]` (contracts/http-api.md): merge the global and dashboard theme, merge plugin-level and widget settings, compute the widget `path` = `dashboardId/widgetId`, strip secret values from the settings sent to the client, and set `clientUrl = /plugins/<id>/client.js` (depends on T022, T023)
- [X] T026 Implement a naive refresh loop in `packages/host/src/refresh/scheduler.ts`: per plugin, on an interval, call `needs()` for all widgets of subscribed dashboards, then call `fetch` (or `mock.fetch` in mock mode) once, then pass each `WidgetData` to an injected `publish(dashboardIds, data)` callback and take the subscribed dashboards from an injected `subscribedDashboards()` function, with no import from `http/`. Batching and de-duplication are refined in US5. (depends on T024, T025)
- [X] T027 Implement the SSE hub in `packages/host/src/http/events.ts`: `GET /api/events?dashboard=:id` using Hono `streamSSE`, a subscriber registry per dashboard, `snapshot` on connect, `widget-data` broadcast, keepalive comments every 25 s, and cleanup on disconnect. Wire the hub's `publish` and `subscribedDashboards` into the scheduler created in T026 inside `main.ts`. (depends on T026)
- [X] T028 Implement the Hono app in `packages/host/src/http/app.ts`: `GET /api/meta` `{version, pluginApiVersion: "1.0.0", mock}`, `GET /api/dashboards`, `GET /api/dashboards/:id`, `GET /plugins/:id/client.js` (from the plugin dir's `client` entry), static `packages/web/dist` with an SPA fallback, and start in `main.ts` through `@hono/node-server` (depends on T025, T027)
- [X] T029 [P] Implement the web live store in `packages/web/src/live/store.ts` (signals keyed by widget path, EventSource connect and reconnect, handling of `snapshot` and `widget-data`), and the plugin module loader in `packages/web/src/live/plugins.ts` (dynamic `import(clientUrl)` with a cache per plugin)
- [X] T030 [P] Fill the import map in `packages/web/index.html` and add `packages/web/src/shared.ts`, which re-exports `preact`, `preact/hooks`, `preact/jsx-runtime`, `@preact/signals`, and `@opsdash/plugin-sdk/client` as separate Vite build entries, so the import map can point to stable hashed URLs written by a small `vite.config.ts` `transformIndexHtml` hook (research R4) *(Implemented as host-generated `/vendor/*.js` shims (`packages/host/src/http/vendor.ts`) that re-export the page's own module instances from `globalThis.__opsdash_shared`, set in `packages/web/src/main.tsx`. This works under Vite HMR and in production; see research R4.)*
- [X] T031 Create `examples/config/opsdash.yaml` with `version: 1`, the `reference` plugin at `^1.0.0`, and an `overview` dashboard with 3 reference widgets (`settings.items: ["ITEM-1","ITEM-2","ITEM-3"]`) at distinct grid positions

**Checkpoint**: `pnpm build && pnpm start -- --mock ...` serves a page that receives SSE
data for 3 reference widgets. The layout, theming, and states are still raw.

---

## Phase 3: User Story 1 - Define a dashboard in a config file and view it (Priority: P1) 🎯 MVP

**Goal**: A config-defined dashboard renders on the 12-column grid with light and dark
themes and design tokens, with dashboard navigation, a mock badge, and config hot reload.
There are no in-UI editors.

**Independent Test**: With `examples/config` in mock mode, every widget renders at its
configured position and size in the configured theme. Editing the theme in YAML changes the
open page within 3 s.

### Tests for User Story 1

- [X] T032 [P] [US1] E2E test in `tests/e2e/us1-render.spec.ts` covering US1 scenarios 1–6: widget boxes match the configured `at`/`size` grid areas; navigation between 2 dashboards; `data-theme` switches when YAML `theme.mode` changes (within 3 s, SC-007); a token override `color-accent` is applied to the host and the widget; no edit controls exist except track and untrack; the mock badge is visible (FR-050)
- [X] T033 [P] [US1] Unit test in `packages/web/tests/unit/grid.test.tsx` checking that placements map to CSS `grid-column: col / span w` and `grid-row: row / span h`, and collapse to one column ordered row-then-column below 640 px

### Implementation for User Story 1

- [X] T034 [P] [US1] Define design tokens in `packages/web/src/theme/tokens.css`: `--od-` custom properties for every token in contracts/config-format.md, with light defaults on `:root[data-theme=light]`, dark on `:root[data-theme=dark]`, and `system` through `prefers-color-scheme`. All text/background pairs must meet WCAG AA contrast.
- [X] T035 [P] [US1] Implement `applyTheme(theme)` in `packages/web/src/theme/apply.ts`: set `data-theme` and write `tokens`, `tokens-light`, and `tokens-dark` overrides as inline custom properties on the dashboard root
- [X] T036 [P] [US1] Implement the 12-column grid in `packages/web/src/grid/Grid.tsx` and `grid.module.css` (CSS Grid, `gap: var(--od-grid-gap)`, a single column below 640 px, no horizontal scroll from 360 to 3840 px)
- [X] T037 [P] [US1] Implement the widget frame in `packages/web/src/widget/Frame.tsx`: minimal chrome, a title, controls revealed only on `:hover`/`:focus-within`, and a visible focus ring (FR-039, FR-040)
- [X] T038 [P] [US1] Implement the default widget states in `packages/web/src/widget/states.tsx`: loading (skeleton), empty, error (message), stale (with the `lastSuccessAt` relative time), and timeout. Plugins can override them (FR-041).
- [X] T039 [US1] Implement `packages/web/src/widget/Widget.tsx`, which loads the plugin module through `live/plugins.ts`, subscribes to its path signal, and renders `defineWidget().render` inside the Frame, falling back to the default states (depends on T037, T038)
- [X] T040 [US1] Implement `packages/web/src/app.tsx`: fetch `/api/meta` and `/api/dashboards`, use a hash-based route `#/<dashboardId>`, a minimal dashboard switcher, the persistent **Mock mode** badge when `meta.mock`, and a helpful empty state explaining where `opsdash.yaml` goes when no dashboards exist (depends on T035, T036, T039)
- [X] T041 [US1] Implement the config watcher in `packages/host/src/config/watch.ts`: chokidar on the config dir, a 150 ms debounce, reload and re-resolve, diff the dashboards, and emit `dashboard-changed {id}` or `dashboards-changed` over the SSE hub (FR-011)
- [X] T042 [US1] Handle `dashboard-changed` and `dashboards-changed` in `packages/web/src/live/store.ts` by re-fetching `/api/dashboards/:id` and re-applying the theme and layout without a full page reload
- [X] T043 [US1] Add a second dashboard `details` and a `theme.tokens.color-accent` override to `examples/config/opsdash.yaml`

**Checkpoint**: MVP. A config-defined dashboard renders, is themed, and hot-reloads.

---

## Phase 4: User Story 2 - Get clear errors for invalid configuration (Priority: P1)

**Goal**: Every config error names the file, line, column, and document path, in plain
language. An invalid dashboard doesn't break the valid ones.

**Independent Test**: `pnpm test:config-errors` passes over at least 20 fixtures. A broken
and a valid dashboard coexist in the UI.

### Tests for User Story 2

- [X] T044 [P] [US2] Create at least 20 invalid-config fixtures in `tests/fixtures/invalid-config/<case>/opsdash.yaml`, each with an `expected.json` `{file, line, column, path, messageIncludes}`. Cover: missing `version`; unknown `version`; YAML syntax error; missing widget `id`; bad slug; `at` column 0; `at` column 13; `size` overflowing past column 12; overlapping widgets; a duplicate widget id among siblings; a duplicate dashboard id; unknown `plugin` key type; an invalid duration; an unknown token key; a bad theme mode; plugin settings breaking the reference schema (`view: "grid"`); a missing plugin `version`; an invalid semver range; `with` on a widget placement; an unknown top-level key
- [X] T045 [P] [US2] Contract test in `tests/contract/config-errors.test.ts`, which loads each fixture and asserts the error matches `expected.json`, then asserts that a mixed fixture (one valid and one invalid dashboard) resolves the valid one with `status: "ok"` (SC-002, FR-009). Also add a **reference config** contract test in `tests/contract/reference-config.test.ts`: load `examples/config`, assert zero errors, and snapshot the resolved dashboards (constitution quality gate). Wire both to the root script `test:config-errors`.

### Implementation for User Story 2

- [X] T046 [US2] Implement `locate(doc, lineCounter, zodPath)` in `packages/host/src/config/locate.ts`, which walks the `yaml` Document to the node at a Zod issue path and returns `{line, column}` from `node.range[0]`, falling back to the closest ancestor (this is the custom code justified in the plan's Complexity Tracking)
- [X] T047 [US2] Build `ConfigError {file, line, column, path, message, scope}` in `packages/host/src/config/errors.ts`, turning Zod issues into plain-language messages (for example `Widget "x" extends to column 14; the grid has 12 columns.`) and turning YAML parse errors into `file:line:col` with `valid = false`
- [X] T048 [US2] Add cross-field validation in `packages/host/src/config/validate.ts`: grid bounds (`col + w - 1 ≤ 12`), pairwise overlap among siblings, unique sibling ids, and unique dashboard ids across the set (the error names both locations). Each error gets its `scope.dashboard` or `scope.block`.
- [X] T049 [US2] Make validation per dashboard in `packages/host/src/config/load.ts` and `resolve.ts`: an error scoped to a dashboard sets that dashboard's `status: "invalid"` and `errors`, and every other dashboard still resolves
- [X] T050 [US2] Implement `GET /api/status` in `packages/host/src/http/app.ts`, returning `{config: {files, errors}, plugins: []}` (plugins are filled in by US3), and log every error as `{event: "config.error", file, line, column, path, message}`
- [X] T051 [US2] Implement the error view in `packages/web/src/dashboard/Errors.tsx`, which shows a dashboard's errors in place of its content, formatted `file:line:col path` plus the message, and never shows stale content (US2-5)

**Checkpoint**: US1 and US2 both work. Config mistakes are self-explanatory.

---

## Phase 5: User Story 3 - Plugins load safely and fail in isolation (Priority: P1)

**Goal**: Plugins with an incompatible, incomplete, duplicate, mutating, or mock-less
manifest are refused with a reason. Runtime errors and timeouts affect only their own
widgets. Missing or out-of-range plugins show placeholders.

**Independent Test**: Put the fixture plugin variants in a plugin dir. Every refusal and
failure is visible and scoped to its widgets, and the rest of the dashboard keeps updating.

### Tests for User Story 3

- [X] T052 [P] [US3] Create plugin fixture variants in `tests/fixtures/plugins/`: `bad-api` (apiVersion `^2.0.0`), `no-manifest-fields` (missing `server`), `dup-a` and `dup-b` (same id), `mutating` (capabilities `["write"]`), `no-mock` (server module without `mock`), `throws` (fetch throws), `slow` (fetch waits 30 s, respects the signal), and `import-crash` (throws at module top level) *(Variants are generated from the built reference plugin by `tests/fixtures/plugins/variants.ts`, so they stay in sync with it.)*
- [X] T053 [P] [US3] Integration test in `packages/host/tests/integration/plugins.test.ts` asserting each variant's `state` and `refusal` text, that both `dup-*` are refused, and that `throws` and `slow` affect only their own widgets while a reference widget on the same dashboard still gets `widget-data` on schedule (SC-005)

### Implementation for User Story 3

- [X] T054 [US3] Implement the static manifest check in `packages/host/src/plugins/manifest.ts` before any `import()`, reading only `dist/opsdash.manifest.json`: the file exists; required fields (`id`, `name`, `version`, `apiVersion`, `server`, `client`, `capabilities`, `env`, `refresh`, `settingsSchema`, `referenceSchema`, `hasMock: true`), `semver.satisfies("1.0.0", apiVersion)`, capabilities limited to `["track"]` (anything else gives "mutating capabilities are not yet supported"), and duplicate ids (refuse all holders) (FR-015, FR-016)
- [X] T055 [US3] Extend `packages/host/src/plugins/registry.ts`: catch errors from importing the server module (state `refused`), refuse when the default export has no `mock` (FR-049), record `{id, version, state, refusal}`, and log `{event: "plugin.refused", id, reason}`
- [X] T056 [US3] Isolate failures in `packages/host/src/refresh/scheduler.ts`: wrap each `fetch` in try/catch plus `AbortSignal.timeout`, map a thrown error to `state: "error"`, map an abort to `state: "timeout"`, never await one plugin before dispatching another, and give each plugin its own timer
- [X] T057 [US3] Compute placeholders in `packages/host/src/config/resolve.ts`: a missing plugin gives `plugin-missing`, a version outside the configured range gives `plugin-incompatible`, and a refused plugin gives `plugin-refused`. Each gets `placeholder {pluginId, requiredVersion, reason}` (FR-019).
- [X] T058 [P] [US3] Implement `packages/web/src/widget/Placeholder.tsx`, which renders the placeholder in the widget slot, naming the plugin and required version
- [X] T059 [P] [US3] Implement a Preact error boundary in `packages/web/src/widget/Boundary.tsx` (`componentDidCatch` → error state for that widget only) and wrap every plugin render in `Widget.tsx`
- [X] T060 [US3] Fill `plugins` in `GET /api/status` from the registry records

**Checkpoint**: The host is safe to extend.

---

## Phase 6: User Story 4 - Reuse template blocks and split config across files (Priority: P2)

**Goal**: `include` and `blocks` with parameters and nesting, cycle detection, and
per-use widget paths.

**Independent Test**: One block used on two dashboards and nested in another block, across 3
files, renders identically everywhere. Changing it once updates every use.

### Tests for User Story 4

- [X] T061 [P] [US4] Add block and include fixtures to `tests/fixtures/invalid-config/`: an include cycle (a→b→a), a block nesting cycle, an unknown block name, a `with` key not declared in `params`, an include path that doesn't exist, and a duplicate block name across files. Add a valid multi-file fixture `tests/fixtures/valid-blocks/` (3 files, block nested in block).
- [X] T062 [P] [US4] Unit test in `packages/host/tests/unit/blocks.test.ts` covering expansion, `${title}` substitution, a nested sub-grid, widget paths `overview/team-a/items`, and that a block with a missing plugin still expands with a placeholder

### Implementation for User Story 4

- [X] T063 [US4] Implement include resolution in `packages/host/src/config/include.ts`: paths are relative to the including file; included files may contain only `include`, `plugins`, `dashboards`, and `blocks`; DFS cycle detection names the whole chain; entries are merged, and duplicates are errors that name both locations; `ConfigSet.files` lists every loaded file (FR-003, FR-010)
- [X] T064 [US4] Implement block expansion in `packages/host/src/config/blocks.ts`: `params` defaults, `with` override validation, `${name}` substitution in string fields, nesting-cycle detection, a per-block 12-column sub-grid, and widget path = `dashboardId/blockUseId/.../widgetId` (FR-004, data-model §A)
- [X] T065 [US4] Emit `kind: "block"` items with nested `items` from `packages/host/src/config/resolve.ts`
- [X] T066 [US4] Render nested block sub-grids in `packages/web/src/grid/Grid.tsx`, where a block item renders its own 12-column grid inside its area
- [X] T067 [US4] Watch every file in `ConfigSet.files` in `packages/host/src/config/watch.ts`, not just the root
- [X] T068 [US4] Add `examples/config/blocks.yaml` (a `team-panel` block with a `title` param) and `examples/config/dashboards/team.yaml`, and include both from `examples/config/opsdash.yaml`

**Checkpoint**: Config reuse works.

---

## Phase 7: User Story 5 - Batched, de-duplicated refresh cycles (Priority: P2)

**Goal**: One shared server-side cycle over the widgets visible to any viewer, with
de-duplication by `refKey`, grouping by `batchKey`, chunking by `maxBatchSize`, a
short-lived cache, no overlapping runs, immediate fetches for newly visible widgets, and
partial results.

**Independent Test**: The `batching-demo` dashboard (20 widgets, 25 unique refs) opened in 3
tabs produces 1 mock request per cycle.

### Tests for User Story 5

- [X] T069 [P] [US5] Integration test in `packages/host/tests/integration/batching.test.ts`, using the reference plugin in mock mode, which reads `__mock.requests`. It asserts:
  - 20 widgets and 25 unique refs with duplicates give 1 request per cycle;
  - 3 subscribers give the same count as 1 (SC-004);
  - a dashboard with no subscribers gives 0 requests;
  - refs inside the cache window are not re-requested;
  - `maxBatchSize: 10` with 25 refs gives 3 requests;
  - a slow fetch makes the next tick skip rather than overlap;
  - `errorKeys: ["ITEM-2"]` errors only ITEM-2;
  - a new subscriber to an already-covered dashboard adds 0 requests (US5-7);
  - with mock faults `omitKeys: ["ITEM-3"]` and `extraKeys: ["ZZZ-1"]`, ITEM-3 shows "No result returned" and ZZZ-1 is ignored.

### Implementation for User Story 5

- [X] T070 [US5] Implement the visible set in `packages/host/src/refresh/visibility.ts`: the union of the widget paths of every dashboard with at least one SSE subscriber, updated on subscribe and unsubscribe, which reports newly visible paths *(The visible set is computed in `packages/host/src/server.ts` from `EventHub` subscribers (`packages/host/src/http/hub.ts`).)*
- [X] T071 [US5] Implement the batch planner in `packages/host/src/refresh/plan.ts`: given the visible widgets of one plugin, gather `needs()`, de-duplicate by `refKey`, drop cached keys, group by `batchKey(settings)` (default `"default"`), and chunk to `maxBatchSize`. Return chunks plus a `refKey → widgetPaths[]` map (FR-023).
- [X] T072 [US5] Implement the result cache in `packages/host/src/refresh/cache.ts` using `lru-cache` with `ttl = cacheWindow` (per plugin, default 30 s) and key `pluginId|batchKey|refKey` (FR-025)
- [X] T073 [US5] Rewrite `packages/host/src/refresh/scheduler.ts` on top of the planner: one timer per plugin at the effective interval (config, then manifest, then defaults), an in-flight flag that skips overlapping ticks (FR-026), per-chunk dispatch, fan-out of results to widgets (a requested `refKey` missing from the result map becomes `{error: "No result returned for <refKey>"}`; keys that weren't requested are ignored and logged at debug), and stale state when the last success is older than the interval and the latest fetch failed, with `lastSuccessAt` (FR-027). Log `{event: "refresh.cycle", plugin, requests, refs, durationMs, failures}`.
- [X] T074 [US5] On subscribe in `packages/host/src/http/events.ts`, send a `snapshot` with the latest results for covered widgets and `loading` for uncovered ones, and trigger an immediate planner run for only the newly visible paths (FR-022)
- [X] T075 [US5] Add a `batching-demo` dashboard to `examples/config/dashboards/batching.yaml`: 20 reference widgets whose `settings.items` together reference 25 unique keys with overlaps

**Checkpoint**: Request minimization is proven.

---

## Phase 8: User Story 6 - Persist item references, links, and plugin state (Priority: P2)

**Goal**: Per-widget tracked references, plugin-created links, and namespaced plugin
state, persisted in SQLite through the storage layer. Operators track and untrack items
from widgets. Refs for widgets removed from a valid config are deleted.

**Independent Test**: Track items in the UI, restart, and they're still there. A widget in
a block used on two dashboards keeps separate lists. Removing a widget from a valid config
deletes its refs, while an invalid edit keeps them.

### Tests for User Story 6

- [X] T076 [P] [US6] Migration test in `packages/host/tests/integration/store.test.ts`:
  - a fresh DB migrates;
  - migrating is idempotent on restart;
  - a DB with an unknown migration hash makes the host refuse to start and leaves the file byte-identical (FR-031);
  - a corrupt file is refused;
  - data survives 100 open/close cycles (SC-008).
- [X] T077 [P] [US6] Integration test in `packages/host/tests/integration/tracking.test.ts`:
  - `POST` gives 201, a second `POST` gives 409, invalid input gives 422;
  - `DELETE` gives 204 and cascades links;
  - lists are per widget path (block used twice gives separate lists);
  - plugin A cannot read plugin B's `state`;
  - `refs.find` works across plugins;
  - the store contains no item content (US6-5).
- [X] T078 [P] [US6] Integration test in `packages/host/tests/integration/orphans.test.ts` for the deletion rule (data-model §C):
  - a widget removed from a valid config has its refs deleted and a `refs.deleted` log line written;
  - a YAML syntax error anywhere deletes nothing;
  - a validation error in the widget's dashboard deletes nothing for that dashboard;
  - a renamed block-use id deletes the old path's refs.
- [X] T079 [P] [US6] E2E test in `tests/e2e/us6-tracking.spec.ts`: track `ITEM-7` through the hover control, see it with mock data; track it again and see "already tracked"; track `bad` and see an inline error; untrack it; reload the page and the state persists

### Implementation for User Story 6

- [X] T080 [US6] Define the Drizzle schema in `packages/host/src/store/schema.ts`:
  - `tracked_ref`: `id` integer PK autoincrement, `widget_path` text not null (indexed), `plugin_id` text not null, `ref_key` text not null, `ref` text JSON not null, `created_at` integer not null, **unique(widget_path, ref_key)**.
  - `ref_link`: `id` PK, `from_ref_id` and `to_ref_id` integer FK → `tracked_ref.id` **ON DELETE CASCADE**, `created_by` text, `created_at` integer, **unique(from_ref_id, to_ref_id)**, check `from_ref_id != to_ref_id`.
  - `plugin_state`: PK(`plugin_id`, `key`), `value` text JSON not null, `updated_at` integer.
  - Generate the initial migration into `packages/host/drizzle/`.
- [X] T081 [US6] Implement repositories in `packages/host/src/store/repos.ts` (the ONLY module importing `drizzle-orm` query APIs outside `db.ts`):
  - `trackRef`, `untrackRef`, `listRefs(widgetPath)`, `deleteRefsForPaths(paths)`, `pathsWithRefs()`;
  - `createLink`, `removeLink`, `listLinks(refId)` (both directions), `findRef(pluginId, refKey)`;
  - `stateGet/Set/Delete/List(pluginId, …)`.
- [X] T082 [US6] Wire `ctx.state` (scoped to the calling plugin's id), `ctx.refs.find`, and `ctx.links` into `packages/host/src/plugins/context.ts`, replacing the stubs (FR-021)
- [X] T083 [US6] Include each widget's tracked refs in `needs()` input from `packages/host/src/refresh/plan.ts` (`widget.trackedRefs` from `listRefs(path)`)
- [X] T084 [US6] Implement the tracking routes in `packages/host/src/http/tracking.ts` per contracts/http-api.md: `POST /api/widgets/:path/items` (400 without the `track` capability, 404 for an unknown path, plugin `parseReference` or `mock.parseReference` gives 422 `{error}`, a unique violation gives 409, success gives 201 `{refKey, ref}`) and `DELETE /api/widgets/:path/items/:refKey` (204 or 404). After either, trigger an immediate planner run for that widget.
- [X] T085 [US6] Implement the orphan deletion rule in `packages/host/src/config/orphans.ts`, run after every successful startup load and reload. Delete refs for paths in `pathsWithRefs()` only when `ConfigSet.valid`, the path's dashboard and block chain have no scoped errors (or its dashboard is gone), and the path is not resolved. Log `{event: "refs.deleted", widgetPath, count}` (data-model §C).
- [X] T086 [US6] Implement the track and untrack controls in `packages/web/src/widget/TrackControls.tsx`: shown on hover/focus only when `trackable`; an input plus submit calling POST; inline errors for 409 and 422; a per-item untrack button calling DELETE; keyboard accessible with labels

**Checkpoint**: Persistence and tracking work end to end.

---

## Phase 9: User Story 7 - Secrets come only from the environment (Priority: P3)

**Goal**: Env and env-file secrets, `{env}` references only, server-side use only, redaction
by value, and missing-variable reporting. Mock mode needs no secrets.

**Independent Test**: The secret scan finds zero occurrences. A missing variable is reported
by plugin and variable name, and health is degraded.

### Tests for User Story 7

- [X] T087 [P] [US7] Unit test in `packages/host/tests/unit/secrets.test.ts`:
  - env file values fill only missing keys (process env wins);
  - `secret()` rejects a literal string with a message pointing to `{ env: NAME }`;
  - `ctx.secrets.get` throws for undeclared names;
  - the redactor replaces loaded values in strings and nested objects.
- [X] T088 [P] [US7] Secret-scan test in `tests/contract/secret-scan.test.ts` (root script `test:secret-scan`): start the host non-mock with `REFERENCE_TOKEN=s3cr3t-value-for-scan`, track `LEAK-1` to force a plugin error whose message includes the token, capture stdout, every HTTP response, and the SSE stream, and read the DB file and the config dir. Assert zero occurrences (SC-009).

### Implementation for User Story 7

- [X] T089 [US7] Implement the `secret()` Zod helper in `packages/plugin-sdk/src/secret.ts`, as `z.object({env: z.string().regex(/^[A-Z_][A-Z0-9_]*$/)}).strict()` with a custom error for strings ("Secrets must be referenced as { env: NAME }; literal values are not allowed"), exported from `src/index.ts` (FR-034)
- [X] T090 [US7] Implement env loading in `packages/host/src/secrets/env.ts`: read `--env-file` with `util.parseEnv`, and merge into a private map without overwriting `process.env` keys (FR-033)
- [X] T091 [US7] Implement `ctx.secrets.get(name)` in `packages/host/src/plugins/context.ts`, allowing only names in the manifest `env`, reading the merged map, and registering each value with the redactor
- [X] T092 [US7] Implement value redaction in `packages/host/src/secrets/redact.ts`, replacing registered values with `[REDACTED]` in strings and in nested objects and arrays. Apply it in the pino `hooks.logMethod` and `formatters.log` (log.ts), in plugin error messages before they go into `WidgetData.error`, and in `/api/status` output (FR-035).
- [X] T093 [US7] Validate required env at load in `packages/host/src/plugins/registry.ts`: when not in mock mode and a manifest `env` variable that the plugin's config references is missing, record `REFERENCE_TOKEN missing for plugin reference`, put its widgets into the `error` state, and mark health degraded. Skip this entirely in mock mode (FR-036, FR-048).
- [X] T094 [US7] Make sure `packages/host/src/config/resolve.ts` strips every `{env}`-typed setting from the settings sent to the browser (FR-035)

**Checkpoint**: The secrets mechanism is proven before real integrations.

---

## Phase 10: User Story 8 - Build a plugin against a documented contract (Priority: P3)

**Goal**: Contract tests, author docs, a copyable reference plugin, and dev hot reload of
plugins.

**Independent Test**: Copy `plugins/reference` to `plugins/copy`, change `id` and the widget
text, run `pnpm build`, reference it in config, and it renders with no host change. The
contract tests pass.

### Tests for User Story 8

- [X] T095 [P] [US8] Plugin contract tests in `tests/contract/plugin-api.test.ts` against `plugins/reference` in mock mode, covering:
  - manifest validity and version negotiation;
  - `settings`, `reference`, and `refKey` behaviour;
  - `fetch` handles a 25-ref batch in 1 call;
  - partial results through `errorKeys`;
  - timeout honoured through `ctx.signal`;
  - `parseReference` accepts and rejects;
  - the `mock` export exists and is deterministic for the same `refKey`;
  - `ctx.state` isolation;
  - `ctx.links` create, list, and cascade (FR-044).
- [X] T096 [P] [US8] Copy-plugin test in `tests/contract/copy-plugin.test.ts`: copy `plugins/reference` to a temp dir with a new `id`, build it with the SDK preset, point the host at a plugin dir containing both, and assert both load and render data through `/api/events` (FR-020, US8-2)

### Implementation for User Story 8

- [X] T097 [US8] Implement plugin dev hot reload in `packages/host/src/plugins/watch.ts`: chokidar on each plugin's `dist/`, a 150 ms debounce, re-run the manifest check, re-`import()` the server with `?v=<mtime>`, swap it into the registry, emit SSE `plugin-reloaded {id, clientUrl}` (with `?v=`), and trigger an immediate planner run (research R6) *(The plugin watcher lives in `packages/host/src/server.ts`; `pnpm dev` runs the host with `node --watch-path=src` so plugin rebuilds hot-reload instead of restarting the host.)*
- [X] T098 [US8] Handle `plugin-reloaded` in `packages/web/src/live/plugins.ts` and `Widget.tsx`: drop the cached module, re-import `clientUrl`, and re-mount only that plugin's widgets
- [X] T099 [US8] Write the plugin author guide in `packages/plugin-sdk/README.md`, covering:
  - the manifest fields;
  - the server API and `ctx`;
  - the Plugin Data Pattern (references only, link through the host, live queries, batch every fetch, with an N+1 justification rule);
  - `batchKey` and `maxBatchSize`;
  - `createMockSource` and faults;
  - widget states and tokens;
  - the Vite preset and dev hot reload;
  - versioning.

  Use `plugins/reference` as the worked example (FR-045).
- [X] T100 [US8] Generate the config JSON Schema with `z.toJSONSchema(configSchema)`, serve it at `GET /schema/config.v1.json` in `packages/host/src/http/app.ts`, and add the `yaml-language-server` modeline to `examples/config/opsdash.yaml` (FR-013)

**Checkpoint**: Plugin authors can start building. This is the prerequisite for the
source-system plugin features.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [X] T101 [P] Implement `GET /healthz` in `packages/host/src/http/health.ts`: `unhealthy` (503) when the store fails its check; `degraded` (200) when there are config errors, refused plugins, plugins whose last cycle failed, or missing env; otherwise `healthy` (200). Give `reasons[]` (FR-047).
- [X] T102 [P] Add structured log events for store migrations (`store.migrated {from, to}`) and startup (`server.ready {port, mock, plugins}`) in `packages/host/src/main.ts` (FR-046)
- [X] T103 [P] Accessibility E2E test in `tests/e2e/a11y.spec.ts` using `@axe-core/playwright` (WCAG 2.2 AA tags) on the overview, team, and error-state dashboards, in the light and dark themes, at 360, 1280, and 3840 px. Assert zero violations and no horizontal scroll (`scrollWidth <= clientWidth`) (SC-010).
- [X] T104 [P] Isolation E2E test in `tests/e2e/us3-isolation.spec.ts`, which toggles `plugins.reference.mock.latencyMs: 20000` in a temp config copy and asserts the timeout state on reference widgets while the page stays responsive
- [X] T105 [P] Performance check in `tests/e2e/perf.spec.ts`: the `batching-demo` dashboard (20 widgets) reaches its final state for every widget within 2 s of navigation (SC-006). Also add a cold-start script `scripts/coldstart.mjs` asserting `/healthz` is healthy within 1.5 s and RSS ≤ 150 MB at idle. *(Measured: 441 ms to healthy, 124 MB idle RSS, after loading drizzle-orm's CommonJS build; see plan Complexity Tracking.)*
- [X] T106 Write the operator docs in `README.md`, covering:
  - running with `opsdash --config --plugins --db --env-file --mock`;
  - the config format summary with a link to the schema;
  - that there is no built-in authentication, so run it on a trusted network or behind an authenticating reverse proxy (FR-042);
  - mock mode with a separate `--db`;
  - the `pnpm dev` hot reload.
- [X] T107 Add a CI workflow in `.github/workflows/ci.yml` running `pnpm install --frozen-lockfile`, `typecheck`, Biome, `build`, `test`, `test:config-errors`, `test:secret-scan`, `size`, and `test:e2e` (on Chromium)
- [X] T108 Run every section of `specs/001-dashboard-host/quickstart.md` manually and fix any deviations

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user story phases → **Polish**.
- Phase 2 blocks every story. It delivers the SDK, the reference plugin, loading on the
  happy path, the base config, the store runner, HTTP/SSE, and the naive refresh loop.

### User story dependencies

| Story | Depends on | Notes |
|-------|-----------|-------|
| US1 (P1) | Phase 2 | MVP |
| US2 (P1) | Phase 2 | Adds error locations. The error view plugs into US1's app shell, but can be tested through the API alone. |
| US3 (P1) | Phase 2 | Placeholder and boundary UI slot into US1's `Widget.tsx` |
| US4 (P2) | Phase 2, US2 (reuses the locate and errors modules) | |
| US5 (P2) | Phase 2 | Replaces the naive scheduler. US3's isolation (T056) must be merged into T073. |
| US6 (P2) | Phase 2, US5 (T083 extends the planner) | The orphan rule uses US2's scoped errors and US4's block paths when present |
| US7 (P3) | Phase 2 | |
| US8 (P3) | US3 (manifest check), US6 (links and state in the contract tests) | |

### Within each story

Write the tests, then the host modules, then the HTTP layer, then the web UI, then the
example config.

## Parallel Opportunities

- **Phase 1**: T003–T008 are all [P].
- **Phase 2**:
  - T010–T014 (SDK) in parallel with T017–T020 (host primitives);
  - T029 and T030 (web live layer) in parallel with the host HTTP work.
- **After Phase 2**:
  - US1, US2, US3, US5, and US7 can proceed in parallel. They touch different modules,
    apart from the shared `scheduler.ts` (US3 T056 and US5 T073) and `resolve.ts`
    (US2, US3, US4, US7), which should be sequenced.
  - US4 follows US2. US6 follows US5. US8 comes last.

### Parallel example: User Story 1

```text
Task: "E2E test for US1 in tests/e2e/us1-render.spec.ts"            (T032)
Task: "Grid unit test in packages/web/tests/unit/grid.test.tsx"      (T033)
Task: "Design tokens in packages/web/src/theme/tokens.css"           (T034)
Task: "applyTheme in packages/web/src/theme/apply.ts"                (T035)
Task: "12-column grid in packages/web/src/grid/Grid.tsx"             (T036)
Task: "Widget frame in packages/web/src/widget/Frame.tsx"            (T037)
Task: "Default widget states in packages/web/src/widget/states.tsx"  (T038)
```

### Parallel example: User Story 6

```text
Task: "Migration test in packages/host/tests/integration/store.test.ts"      (T076)
Task: "Tracking test in packages/host/tests/integration/tracking.test.ts"    (T077)
Task: "Orphan rule test in packages/host/tests/integration/orphans.test.ts"  (T078)
Task: "Tracking E2E in tests/e2e/us6-tracking.spec.ts"                       (T079)
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1 (Setup), then Phase 2 (Foundational).
2. Phase 3 (US1). **Stop and validate** with quickstart §2 (render, theme, hot reload, mock
   badge).

### Incremental delivery

1. Add US2 (clear errors), then US3 (safe plugins). That completes the P1 set: a usable,
   safe host.
2. Add US4 (blocks and includes), then US5 (batching), then US6 (tracking and persistence).
   That completes the P2 set: the full data pattern.
3. Add US7 (secrets), then US8 (plugin contract and docs). That completes the P3 set: ready
   for the source-system plugins.
4. Polish: health, a11y, performance, CI, docs, and the quickstart run.

---

## Notes

- Every test and the whole E2E suite run in mock mode. No source systems are needed.
- Database access happens only in `packages/host/src/store/` (constitution).
- Custom code limited to the two items in the plan's Complexity Tracking; anything else hand-rolled needs a written justification.
- Commit after each task or logical group, and stop at any checkpoint to validate.

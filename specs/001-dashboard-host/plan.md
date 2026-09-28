# Implementation Plan: Core Dashboard Host

**Branch**: `001-dashboard-host` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-dashboard-host/spec.md`

## Summary

This feature builds the Opsdash host: one Node.js process that loads dashboards from YAML
config files and renders them in a Vite and Preact UI on a 12-column token-themed grid. The
host:

- loads drop-in plugins through a versioned plugin API;
- keeps only per-widget item references, links, and plugin state in SQLite, through Drizzle;
- runs one shared server-side refresh cycle that batches and de-duplicates source requests
  and pushes results to every viewer over SSE.

It also delivers a mock mode, which routes every plugin to its required mock source, and a
hot-reload dev setup. A reference plugin proves the whole contract. See
[research.md](./research.md) for the decisions behind these choices.

## Technical Context

**Language/Version**: TypeScript 5.x (strict, `erasableSyntaxOnly`) on Node.js 24 LTS. The
browser targets evergreen browsers that support import maps.

**Primary Dependencies**:
- **Server**: Hono and @hono/node-server (HTTP and SSE), yaml, zod 4, drizzle-orm with
  better-sqlite3 (and drizzle-kit), chokidar, lru-cache, pino, semver
- **Web**: Vite 8, Preact 10, @preact/signals

**Storage**: SQLite (a single file) through the Drizzle ORM, with versioned drizzle-kit
migrations applied at startup. It holds only references, links, and plugin state.

**Testing**: Vitest (unit, integration, contract), Playwright with @axe-core/playwright
(E2E and WCAG), and size-limit (budgets). All tests run in mock mode.

**Target Platform**: Linux, macOS, or Windows server running Node 24, and evergreen
browsers from 360 px to 3840 px wide.

**Project Type**: A web application (server plus SPA), shipped as one deployable, together
with a plugin SDK package and a reference plugin.

**Performance Goals**:
- Dashboard with 20 widgets fully rendered in 2 s or less (SC-006)
- Config change visible in 3 s or less (SC-007)
- One batched fetch per plugin per source per cycle, independent of the number of viewers
  (SC-003/004)

**Constraints** (the constitution requires this budget, R14):
- Initial web JavaScript: 60 KB gzipped at most. CSS: 15 KB at most.
- Reference plugin client: 10 KB at most.
- Cold start: 1.5 s at most.
- Idle RSS: 150 MB at most.
- No source requests and no secrets needed in mock mode.

**Scale/Scope**: One instance, a few concurrent viewers, tens of dashboards, about 100
widgets, and up to about 10,000 tracked references.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Rule | How this plan complies | Status |
|------|------------------------|--------|
| **I. Plugin-first**: no widget logic in the core; built-in plugins use the public API; plugin failures are isolated | The reference plugin is a separate package that uses only `@opsdash/plugin-sdk`. The host has no widget code. Timeouts, try/catch, and a Preact error boundary wrap each widget. | ✅ |
| **II. File-based config**: YAML is the only source of truth; no UI editors; blocks; validation with locations; format migrations | YAML with a `version: 1` root, `include`, `blocks`, Zod validation mapped to line and column, hot reload. The only UI input is track and untrack, which is data entry (FR-012). | ✅ |
| **III. Read-only by default and no stored credentials** | Mutating capabilities are refused in v1. Secrets come only from env or an env file, as `{env}` references, stay server-side, and are redacted by value. | ✅ |
| **IV. YAGNI, don't reinvent the wheel**: single deployable; SQLite only; justified dependencies; budget | One Node process. Every dependency is justified in research §Dependency justification. Built-in Node features replace dotenv, nodemon, and tsx. The budget is set in R14 and enforced by size-limit. | ✅ |
| **V. Minimalist UI**: tokens; light and dark; WCAG 2.2 AA; responsive; designed widget states | CSS custom-property tokens, `light`, `dark`, and `system` modes, a 12-column grid collapsing to one column, host-provided default states, and axe checks at 3 widths × 2 themes. | ✅ |
| **Plugin data pattern**: store references only; link through the host; query live; batch every fetch; host-coordinated fetching | The store schema holds refs, links, and state only. Links go through `ctx.links`. A live `fetch` is made every cycle. The scheduler de-duplicates, groups by `batchKey`, chunks by `maxBatchSize`, and makes one call per chunk. | ✅ |
| **Storage and contract**: a single storage layer on a multi-dialect ORM; migrations; namespaced plugin storage; versioned plugin API; manifest fields | Drizzle is used only inside `packages/host/src/store/`. `ctx.state` is scoped by plugin ID. Plugin API v1.0.0 is separate from the app version. The manifest declares all required fields plus `env`. | ✅ |
| **Quality gates**: contract tests for the plugin API and config format; migration tests; UI checks | `tests/contract` covers the reference plugin and reference config. `tests/integration/store` covers migrations. E2E runs axe. | ✅ |

**Post-design re-check (after Phase 1)**: ✅ All gates still pass. There's one nuance
(below), and no violations need justifying.

- "One batched fetch per plugin" is refined to "one per plugin per distinct `batchKey`",
  for widgets that point at different source instances. This follows the constitution's
  "as few requests as the source allows", so it's documented rather than treated as a
  deviation.

## Project Structure

### Documentation (this feature)

```text
specs/001-dashboard-host/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── config-format.md # YAML config v1
│   ├── plugin-api.md    # Plugin API v1.0.0 (manifest, server, mock, client)
│   └── http-api.md      # REST + SSE between host and web UI
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
package.json                 # pnpm workspace root: dev/build/test scripts
pnpm-workspace.yaml
tsconfig.base.json
packages/
├── host/                    # Node server (single deployable entry: `opsdash`)
│   ├── src/
│   │   ├── main.ts          # CLI args (--config --plugins --db --env-file --mock --port)
│   │   ├── config/          # YAML load, include resolution, zod schema, error locations, watcher
│   │   ├── plugins/         # discovery, static manifest check, loading, dev reload, sandboxed ctx
│   │   ├── refresh/         # scheduler, visible-set tracking, dedupe/batch/chunk, cache
│   │   ├── store/           # drizzle schema, migrations, repositories (ONLY place with DB access)
│   │   ├── secrets/         # env file merge, secret resolution, value redaction
│   │   ├── http/            # hono app: api routes, SSE, static web + plugin bundles, /healthz
│   │   └── log.ts           # pino setup
│   ├── drizzle/             # generated SQL migrations + journal
│   └── tests/{unit,integration}/
├── web/                     # Vite + Preact SPA
│   ├── index.html           # import map for shared externals
│   ├── src/
│   │   ├── app.tsx          # routing between dashboards, mock badge
│   │   ├── grid/            # 12-col grid, block sub-grids, responsive collapse
│   │   ├── widget/          # frame, error boundary, default states, track/untrack controls
│   │   ├── theme/           # tokens → CSS custom properties, light/dark/system
│   │   └── live/            # EventSource client, signals store, plugin module loader
│   └── tests/unit/
└── plugin-sdk/              # @opsdash/plugin-sdk: types, definePlugin, z, secret(),
    └── src/                 #   createMockSource, client defineWidget, vite preset
plugins/
└── reference/               # reference plugin: server.ts, mock, client widget
examples/
└── config/                  # opsdash.yaml + includes, incl. batching-demo dashboard
tests/
├── contract/                # plugin-API + config-format contract tests (reference plugin, mock mode)
├── e2e/                     # playwright + axe
└── fixtures/                # invalid-config cases (≥ 20), plugin variants (bad manifest, throws, slow, mutating)
```

**Structure Decision**: A pnpm workspace with three packages (host, web, plugin-sdk), the
reference plugin as a fourth package, and the tests that span packages at the root.
`packages/host` serves the built `packages/web` in production. During development, Vite
proxies to the host. This keeps a single deployable while giving plugin authors a separate
SDK package.

## Complexity Tracking

No constitution violations. Two small pieces of custom code are justified here:

| Custom code | Why needed | Library alternative rejected because |
|-------------|------------|--------------------------------------|
| Redacting secrets by value in logs and errors (about 20 lines) | FR-035 requires secret values to be removed wherever they appear | pino redacts by key path only. No maintained library redacts by value. |
| Mapping Zod issue paths to YAML node ranges (about 40 lines) | FR-008 requires line and column for every error | No library connects Zod issues to the `yaml` package's CST |
| Loading drizzle-orm's CommonJS build through `createRequire` (`store/drizzle.ts`, about 10 lines) | Its ESM build added about 200 MB RSS on Node 24, which broke the 150 MB idle budget | Dropping Drizzle would violate the multi-dialect ORM rule; the CJS build is the same library and API |
| Generated `/vendor/*.js` import-map shims (`http/vendor.ts`, about 30 lines) | Plugins must share the page's Preact instance in both dev (Vite HMR) and production | Module Federation is too heavy; pointing at Vite's hashed dependency URLs breaks in dev |

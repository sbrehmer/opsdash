# Implementation Plan: Consolidate Project Structure

**Branch**: `003-consolidate-project-structure` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-consolidate-project-structure/spec.md`

## Summary

Today the repository has ten `package.json` files managed by a pnpm workspace. This plan turns
it into a single pnpm project:

- **One application.** The host and the web UI merge into `src/`, split into `server/`,
  `client/` and `shared/` areas.
- **SDK and plugins stay beside it.** The plugin SDK moves to `sdk/` and remains linked under
  its published name. Built-in plugins stay in `plugins/<id>/`, with only their source code and
  a `plugin.json` manifest.
- **One set of commands.** Install, build, dev, test, typecheck and lint each run as a single
  root command. The only manual prerequisite is mise, which installs the pinned Node and pnpm
  from `mise.toml`.
- **Boundaries enforced by the type check.** TypeScript project references stop browser code
  from importing server code, and stop plugins from reaching into `src/`.
- **Nothing changes at runtime.** Config format, database schema, HTTP API, the plugin API
  version and the built plugin layout (`plugins/<id>/dist/opsdash.manifest.json`) stay the same.

See [research.md](./research.md) for the decisions (R1–R11).

## Technical Context

**Language/Version**: TypeScript 7.0 (strict, `erasableSyntaxOnly`) on Node.js 24.21 (pinned in
`mise.toml`). The server runs `.ts` directly through type stripping. Browsers: evergreen.

**Primary Dependencies**: unchanged.
- Server: Hono, @hono/node-server, zod 4, drizzle-orm with better-sqlite3, yaml, chokidar,
  lru-cache, pino, semver.
- Client: Preact 10, @preact/signals.
- Build: Vite 8.

**Package manager**: pnpm 10.33.0, pinned in `mise.toml` next to Node (it was activated through
corepack before). There is no workspace `packages:` list anymore (R1, R2).

**Storage**: SQLite through Drizzle, unchanged. The migrations folder moves to `drizzle/` with
its files unchanged (R10).

**Testing**: Vitest projects `server`, `client`, `sdk`, `plugins` and `contract`, plus
Playwright with axe for E2E and size-limit for budgets. They all run from the root.

**Target Platform**: Linux, macOS or Windows with Node 24. The Alpine/musl container is
supported for build and test.

**Project Type**: A web application (server and SPA in one app), plus a plugin SDK and built-in
plugins, shipped as one deployable.

**Performance Goals**: a clean build takes at most 110% of today's time (SC-006). Measure the
baseline before any change.

**Constraints**:
- The existing budgets still apply: web initial JS ≤ 60 KB gzip, CSS ≤ 15 KB, plugin client
  limits in `.size-limit.json`, and cold start ≤ 1.5 s.
- No runtime behaviour changes (FR-012).
- The third-party plugin shape must keep working (FR-010).

**Scale/Scope**:
- About 9 code units become 1 application, 1 SDK and 5 plugins, with 1 dependency
  declaration.
- Roughly 150 source and test files move. Import rewrites are mechanical: relative paths,
  `@opsdash/delivery-cells` becomes `#delivery-cells`, and test helpers move.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Rule | How this plan complies | Status |
|------|------------------------|--------|
| **I. Plugin-first**: no widget logic in the core; built-in plugins use only the public API; failures isolated | Plugins stay outside `src/`, import only `@opsdash/plugin-sdk` (and plugin-side `#delivery-cells`), and are still loaded from built `dist/` artefacts. The `plugins` TS project can't include `src/**` (R4). No host code changes behaviour. | ✅ |
| **II. File-based config** | Config format, loader and `config/` and `examples/` paths are unchanged. | ✅ |
| **III. Read-only & no stored credentials; secrets never reach the browser** | This plan makes it stronger: the client TS project can't import `src/server/**`, where secret handling lives (FR-016, R4). The existing secret-scan contract test still runs over `dist/web` and plugin bundles. | ✅ |
| **IV. Lightweight/YAGNI; justified dependencies; single deployable; budget** | No new dependencies. 9 manifests are removed, and pnpm moves from corepack to the existing `mise.toml`. Dev orchestration is a short script instead of a new package (R8). Budgets are unchanged and still enforced by `pnpm size` and `perf:coldstart`. | ✅ |
| **V. Minimalist UI** | No UI changes. E2E and axe run unchanged against the new build output. | ✅ |
| **Plugin data pattern / storage & contract** | Store code only moves (`src/server/store/`) and remains the only SQL user. Migrations are moved unchanged. The plugin API version stays 1.1.x. The manifest shape the host reads is identical. | ✅ |
| **Quality gates**: contract tests for plugin API and config; migration tests | Every existing contract, migration and E2E test is kept, with paths updated. New: `layout.test.ts` (one dependency declaration, clean plugin folders, SDK peer ranges) and a rewritten `copy-plugin.test.ts` that builds a plugin in the third-party shape. | ✅ |

**Post-design re-check (after Phase 1)**: ✅ All gates still pass. One structural exception is
recorded below: the SDK's publishing manifest.

## Project Structure

### Documentation (this feature)

```text
specs/003-consolidate-project-structure/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R11
├── data-model.md        # Phase 1: layout, manifests, dependency declaration
├── quickstart.md        # Phase 1: validation guide (fresh machine, boundary, third-party plugin)
├── contracts/
│   ├── commands.md          # root commands (install/build/dev/test/…)
│   ├── plugin-manifest.md   # plugin.json + package.json fallback, SDK preset behaviour
│   └── layout.md            # directory contract and import boundaries
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root, after this feature)

```text
package.json              # the only dependency declaration; scripts; engines/devEngines/packageManager; imports (#delivery-cells)
pnpm-lock.yaml
pnpm-workspace.yaml       # settings only: onlyBuiltDependencies, engineStrict (no packages list)
mise.toml                 # node + pnpm pins
tsconfig.base.json        # shared compiler options
tsconfig.json             # files: [], references every project below (tsc -b)
vite.config.ts            # client app: root src/client → dist/web
vitest.config.ts          # projects: server, client, sdk, plugins, contract
playwright.config.ts
drizzle.config.ts
biome.json  .size-limit.json  MIGRATION.md  README.md

src/
├── server/               # was packages/host/src — config/ http/ plugins/ refresh/ secrets/ store/
│   ├── main.ts           #   CLI entry (package "bin": opsdash)
│   ├── server.ts  db-cli.ts  log.ts
│   └── tsconfig.json     #   composite; refs shared, sdk
├── client/               # was packages/web — index.html, public/, main.tsx, app.tsx,
│   │                     #   dashboard/ grid/ live/ theme/ widget/, api.ts (fetch helpers)
│   └── tsconfig.json     #   composite; refs shared, sdk
└── shared/               # wire types used by both sides (api-types.ts)
    └── tsconfig.json

sdk/                      # was packages/plugin-sdk — published as @opsdash/plugin-sdk
├── package.json          #   publishing manifest only: exports + peerDependencies
├── src/  (index.ts, client/, vite.ts, …)
├── README.md
└── tsconfig.json

plugin-lib/
└── delivery-cells/       # was packages/delivery-cells; imported as #delivery-cells

plugins/
├── tsconfig.json         # one composite project for all plugins (+ plugin-lib); refs sdk
└── <id>/                 # delivery, github, jenkins, jira, reference
    ├── plugin.json       #   manifest (was package.json "opsdash" + name/version)
    ├── src/
    ├── tests/            #   optional (delivery)
    └── dist/             #   build output read by the host (unchanged)

drizzle/                  # was packages/host/drizzle (files unchanged)
dist/web/                 # was packages/web/dist
scripts/                  # opsdash.mjs, build-plugins.mjs (new), dev.mjs (new), coldstart.mjs, seed-delivery.mjs
tests/
├── server/               # was packages/host/tests (unit/, integration/, helpers.ts, dump-fixtures.ts)
├── client/               # was packages/web/tests
├── contract/  e2e/  fixtures/
└── tsconfig.json
config/  examples/        # unchanged
```

**Structure Decision**: One application in `src/`, split into `server/`, `client/` and
`shared/` (chosen by the user). The SDK and plugins stay outside the application so that the
plugin API boundary remains visible and is enforced. The full old-to-new path map is in
[data-model.md](./data-model.md#path-map).

## Implementation Order (for /speckit-tasks)

Each step leaves the repository green, meaning `pnpm test`, typecheck, lint and E2E pass.

1. **Baseline**: record today's clean-build time, size-limit output and cold start.
2. **Single manifest + pinned pnpm (US1, US2)**:
   - Add `"npm:pnpm" = "10.33.0"` to `mise.toml` (see R1, amended).
   - Merge all dependencies into the root `package.json`, and delete every other `package.json`
     except `sdk/package.json`.
   - Reduce `pnpm-workspace.yaml` to settings only (`onlyBuiltDependencies`, `engineStrict`).
   - Add `engines`, `devEngines` and `"@opsdash/plugin-sdk": "link:./sdk"`, then run
     `pnpm install` and commit the regenerated `pnpm-lock.yaml`.
   - Update the README quick start.
3. **Move files** (`git mv`, then fix imports):
   - SDK → `sdk/`, delivery-cells → `plugin-lib/`
   - host → `src/server/`, web → `src/client/`, migrations → `drizzle/`, tests → `tests/…`
4. **Plugins**: replace each plugin's `package.json` with a `plugin.json`, give the SDK preset
   its `plugin.json`-first loading, add `scripts/build-plugins.mjs`, and delete per-plugin
   `vite.config.ts` and `tsconfig.json`.
5. **`src/shared/`**: move the duplicated wire types there, and have server and client import
   them.
6. **TS project references + boundary** (R4): check that an import across the boundary fails.
   Fall back to Biome if needed.
7. **Scripts and configs**:
   - `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts` (web server command
     `node src/server/main.ts …`), `.size-limit.json` (`dist/web/assets/*`), `biome.json`
   - `scripts/opsdash.mjs` build check and stale-layout hint, `scripts/dev.mjs`
8. **Tests**: add `layout.test.ts`, and rewrite `copy-plugin.test.ts` to use the third-party
   shape.
9. **Docs**: README layout section (FR-007), `MIGRATION.md` (FR-014), `sdk/README.md` (how to
   build a plugin externally).
10. **Validate**: work through [quickstart.md](./quickstart.md) on a clean Debian container and
    on Alpine, and compare against the baseline.

## Risks

| Risk | Mitigation |
|------|------------|
| A contributor runs `pnpm` without having run `mise install` first (for example a pnpm that was globally installed, or none at all) | `packageManager` plus `packageManagerStrict` catch a wrong tool. `engineStrict` catches a wrong Node. The README makes `mise install` step 1. The quickstart covers a clean container with only mise installed. |
| TS 7 declaration emit for composite projects produces many errors that aren't real problems | Documented fallback to per-area tsconfigs plus Biome `noRestrictedImports` (R4). |
| Import rewrites break subtly (for example `import.meta.dirname`-relative paths such as `DEFAULT_WEB_DIR`, `MIGRATIONS_DIR`, test `REPO`) | Grep for every `import.meta.dirname` use and cover each in the tasks. E2E and `db-cli` status are part of the validation. |
| Moved migration files change their hashes | They are moved with `git mv` and not touched. A migration test runs against a database created before the move. |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A second `package.json` remains (`sdk/package.json`), against FR-001's "exactly one" | Third-party plugins import `@opsdash/plugin-sdk` by that name (FR-010). Node needs a real `node_modules` entry to resolve it at runtime. The spec's Assumptions allow the SDK a minimal description of its own. It holds no `dependencies` or `devDependencies`: only `exports` and `peerDependencies`, which `layout.test.ts` checks against the root. | Subpath imports or `paths` aliases would change every plugin's import specifier and break external plugins. Node doesn't resolve tsconfig `paths`. |

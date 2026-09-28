---

description: "Task list for 003-consolidate-project-structure"
---

# Tasks: Consolidate Project Structure

**Input**: Design documents from `specs/003-consolidate-project-structure/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (commands, plugin-manifest, layout), quickstart.md

**Tests**: The plan calls for specific tests: `tests/contract/layout.test.ts`, a toolchain check, an SDK manifest-source unit test, and a rewrite of `tests/contract/copy-plugin.test.ts`. No other new tests are added. Every existing test must keep passing (SC-004).

**Organization**: Phase 2 does the structural move and the manifest merge. They can't be separated, because they share one `pnpm install`, so every story depends on Phase 2. The story phases after it add each story's guarantees, checks and docs.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: The user story the task belongs to (US1–US4)

## Path Conventions

The target layout is in plan.md ("Source Code"), and the full old-to-new path map is in data-model.md ("Path map"). Use `git mv` for every move so history is kept. Never edit files under `drizzle/` (migration hashes must stay the same).

---

## Phase 1: Setup

**Purpose**: Branch, baseline and tool pin.

- [X] T001 Create and switch to branch `003-consolidate-project-structure` from `main` (`git switch -c 003-consolidate-project-structure`). Leave the unrelated uncommitted changes (`config/dashboards/demo.yaml` deleted, `config/mock.yaml` modified) untouched and unstaged.
- [X] T002 Record the baseline on the current layout in `specs/003-consolidate-project-structure/baseline.md`, before any structural change:
  - clean build time: `rm -rf node_modules packages/*/node_modules plugins/*/node_modules packages/web/dist plugins/*/dist && time (pnpm install && pnpm build)`
  - `pnpm size` output
  - `pnpm perf:coldstart` output
  - the test counts from `pnpm test` and `pnpm test:e2e` (quickstart §0)
- [X] T003 [P] Add `"npm:pnpm" = "10.33.0"` under `[tools]` in `mise.toml`, next to `node = "24.21.0"`, and run `mise install` (research R1, amended after `pnpm = "10.34.5"` failed on musl and the trust check).

---

## Phase 2: Foundational (structural move + single manifest)

**Purpose**: Reach the target layout with one dependency declaration, with everything still green.

**⚠️ CRITICAL**: No user-story phase can start until T024 passes.

### Move components

- [X] T004 Move the plugin SDK:
  - `git mv packages/plugin-sdk sdk`
  - Rewrite `sdk/package.json` as a publishing manifest only. Keep `name` (`@opsdash/plugin-sdk`), `version` (`1.0.0`), `type` and `exports` (`.`, `./client`, `./vite`) unchanged.
  - Set `peerDependencies` to `{ "zod": "^4.6.5", "preact": "^10.29.0", "vite": "^8.0.0" }`.
  - Remove `scripts`, `dependencies` and `devDependencies`. The allowed fields are `name`, `version`, `type`, `description`, `license`, `exports`, `files` and `peerDependencies` (data-model.md).
- [X] T005 [P] Move the delivery cells:
  - `git mv packages/delivery-cells/src/index.tsx packages/delivery-cells/src/cells.module.css packages/delivery-cells/src/css-modules.d.ts plugin-lib/delivery-cells/`
  - Delete `packages/delivery-cells/package.json` and `packages/delivery-cells/tsconfig.json` (research R6).
- [X] T006 [P] Move the host:
  - `git mv packages/host/src src/server`
  - `git mv packages/host/drizzle drizzle`
  - `git mv packages/host/drizzle.config.ts drizzle.config.ts`, then set `schema: "./src/server/store/schema.ts"` and `out: "./drizzle"` in it
  - `git mv packages/host/tests tests/server`
- [X] T007 [P] Move the web UI:
  - `git mv packages/web/src src/client`
  - `git mv packages/web/index.html src/client/index.html`
  - `git mv packages/web/public src/client/public`
  - `git mv packages/web/tests tests/client`
  - In `src/client/index.html`, change the entry script `src="/src/main.tsx"` to `src="/main.tsx"`, because the Vite root becomes `src/client`.
- [X] T008 Fix the paths the server computes at runtime (data-model.md "Paths computed at runtime"):
  - In `src/server/server.ts`, set `DEFAULT_WEB_DIR = resolve(import.meta.dirname, "../../dist/web")`.
  - In `src/server/store/db.ts`, set `MIGRATIONS_DIR = join(import.meta.dirname, "../../../drizzle")`.
- [X] T009 Fix test imports and paths:
  - `tests/server/helpers.ts`: `REPO = resolve(import.meta.dirname, "../..")`, and import `../../src/server/server.ts`.
  - Every other file under `tests/server/**`: rewrite relative imports of the old `../src/…` or `../../src/…` to reach `src/server/…` from the new location.
  - `tests/server/dump-fixtures.ts`: rewrite the paths as `../fixtures/invalid-config` and `../../plugins`.
  - `tests/client/**`: rewrite imports to `../../src/client/…`.
  - `tests/contract/**/*.ts` and `tests/e2e/global-setup.ts`: replace `packages/host/src` → `src/server`, `packages/host/tests` → `tests/server` and `packages/web/dist` → `dist/web`.
  - Confirm with `grep -rn "packages/" tests` (expected: no matches).
- [X] T010 [P] Replace `from "@opsdash/delivery-cells"` with `from "#delivery-cells"` in `plugins/delivery/src/client.tsx`, `plugins/github/src/client.tsx`, `plugins/jenkins/src/client.tsx` and `plugins/jira/src/client.tsx`.

### Plugins without a package.json

- [X] T011 Change `sdk/src/vite.ts` to read the manifest source per contracts/plugin-manifest.md:
  - Extract and export `readManifestSource(root: string): { name: string; version: string; fields: PluginManifestSource }`.
  - Resolution order: (1) `<root>/plugin.json`, where `{ name, version, ...fields }` are the top-level keys; (2) `<root>/package.json` with an `opsdash` field, taking `name` and `version` from the package; (3) otherwise throw `No plugin manifest: add plugin.json or an "opsdash" field in package.json (<root>)`.
  - Also throw if `name` or `version` is missing.
  - `closeBundle` builds the manifest as `{ ...fields, name, version, ...plugin.jsonSchemas(), hasMock, style? }`, exactly as today.
- [X] T012 [P] For each of `plugins/{delivery,github,jenkins,jira,reference}`:
  - Create `plugin.json` with `name` and `version` from its `package.json`, plus every key of its `opsdash` object at top level (for example `plugins/github/plugin.json` = contracts/plugin-manifest.md example).
  - Then delete that plugin's `package.json`, `vite.config.ts`, `tsconfig.json` and `node_modules/`.
- [X] T013 Create `scripts/build-plugins.mjs` per contracts/plugin-manifest.md:
  - Discover `plugins/*` directories that contain `plugin.json` or `package.json`.
  - Build them all concurrently with Vite's `build()`: `{ root: dir, configFile: false, logLevel: "warn", plugins: [opsdashPlugin()] }`. If the directory has its own `vite.config.*`, use `{ root: dir, configFile: <that file> }` instead.
  - Prefix errors with the plugin id, and exit non-zero if any plugin fails.
  - `--watch` passes `build.watch` and also watches `plugin-lib/` and `sdk/src/`.

### Root configuration

- [X] T014 Create the root `vite.config.ts` from `packages/web/vite.config.ts`:
  - Keep the Preact preset and the dev proxy list (`/api`, `/plugins`, `/schema`, `/vendor`, `/healthz` → `OPSDASH_HOST ?? http://localhost:4400`, port 5173).
  - Set `root: "src/client"` and `build: { outDir: "../../dist/web", emptyOutDir: true, target: "es2022" }`.
- [X] T015 Rewrite the root `package.json` (data-model.md "Project dependency declaration"):
  - **Fields**: `name` `opsdash`, `private` `true`, `type` `module`, `packageManager` `pnpm@10.34.5`, `engines` `{ "node": ">=24.21" }`, `devEngines` `{ "packageManager": { "name": "pnpm", "onFail": "error" } }`, `bin` `{ "opsdash": "src/server/main.ts" }`, `imports` `{ "#delivery-cells": "./plugin-lib/delivery-cells/index.tsx" }`.
  - **`dependencies`**: `@hono/node-server ^2.1.1`, `@opsdash/plugin-sdk link:./sdk`, `@preact/signals ^2.11.2`, `better-sqlite3 ^13.0.3`, `chokidar ^5.0.0`, `drizzle-orm ^0.45.3`, `hono ^4.13.9`, `lru-cache ^11.5.3`, `pino ^10.3.1`, `preact ^10.29.8`, `semver ^7.8.5`, `yaml ^2.9.1`, `zod ^4.6.5`.
  - **`devDependencies`**: `@axe-core/playwright ^4.13.0`, `@biomejs/biome ^2.5.14`, `@playwright/test ^1.63.0`, `@preact/preset-vite ^2.10.6`, `@size-limit/file ^14.1.0`, `@testing-library/preact ^3.2.4`, `@types/better-sqlite3 ^9.6.0`, `@types/node ^24.0.0`, `@types/semver ^7.8.0`, `drizzle-kit ^0.31.11`, `happy-dom ^20.0.0`, `size-limit ^14.1.0`, `typescript ^7.0.2`, `vite ^8.3.1`, `vitest ^5.0.2`.
  - No package may appear in both lists.
  - **`scripts`** per contracts/commands.md:
    - `build` = `vite build && node scripts/build-plugins.mjs`
    - `dev` = `node scripts/dev.mjs`
    - `start` = `node src/server/main.ts`
    - `db:generate` = `drizzle-kit generate`
    - `typecheck` = `tsc -p sdk && tsc -p src/server && tsc -p src/client && tsc -p plugins && tsc -p tsconfig.json`. This is temporary; T034 replaces it with `tsc -b`.
    - Keep all other scripts unchanged.
- [X] T016 Rewrite `pnpm-workspace.yaml` to settings only: remove `packages:`, keep `onlyBuiltDependencies: [better-sqlite3, esbuild]`, and add `engineStrict: true`. Then:
  - Delete what remains of `packages/`: the `package.json` files, tsconfigs and `packages/web/vite.config.ts`/`vitest.config.ts`.
  - Run `rm -rf node_modules && pnpm install`, and commit the regenerated `pnpm-lock.yaml`.
- [X] T017 [P] Create interim per-area tsconfigs, all extending `tsconfig.base.json`:
  - `sdk/tsconfig.json`: `include ["src"]`.
  - `src/server/tsconfig.json`: `include ["."]`, the same options as the old host config.
  - `src/client/tsconfig.json`: `module esnext`, `moduleResolution bundler`, `types ["vite/client"]`, `include ["."]`.
  - `plugins/tsconfig.json`: `module esnext`, `moduleResolution bundler`, `types ["vite/client", "node"]`, `include ["*/src", "*/tests", "../plugin-lib"]`.
  - Root `tsconfig.json`: `include ["tests", "scripts", "vite.config.ts", "vitest.config.ts", "playwright.config.ts", "drizzle.config.ts"]`.
- [X] T018 [P] Rewrite `vitest.config.ts` projects:
  - `server`: include `tests/server/**/*.test.ts`, testTimeout 20000.
  - `client`: Preact preset plugin, `environment: "happy-dom"`, include `tests/client/**/*.test.tsx`.
  - `sdk`: include `sdk/tests/**/*.test.ts`, `passWithNoTests: true`.
  - `plugins`: include `plugins/*/tests/**/*.test.ts`.
  - `contract`: root `tests/contract`, unchanged, testTimeout 60000.
- [X] T019 [P] Update `playwright.config.ts` `webServer.command` to `node src/server/main.ts --config .data/e2e-config --plugins plugins --db .data/e2e.db --mock --port 4411`. In `.size-limit.json`, change `packages/web/dist/assets/*.js` and `*.css` to `dist/web/assets/*.js` and `dist/web/assets/*.css`.
- [X] T020 Update `scripts/opsdash.mjs`:
  - `HOST = join(ROOT, "src/server")`.
  - `checkBuilt()`: check `dist/web/index.html` (label `web`) and every plugin dir that has `plugin.json` or `package.json` but no `dist/opsdash.manifest.json`. The message is `Not built yet: … Run \`pnpm build\` first.`
  - Add the stale-layout warning from contracts/commands.md whenever `packages/` or any `plugins/*/node_modules` exists. It warns but does not exit.
  - Also update the header comment.
- [X] T021 [P] In `scripts/coldstart.mjs`, replace `packages/host/src/main.ts` with `src/server/main.ts`.
- [X] T022 Create `scripts/dev.mjs` (research R8). It spawns three processes with `[server]`, `[web]` and `[plugins]` prefixes on their output:
  1. `node --watch-path=src/server --watch-path=src/shared --watch-path=sdk/src src/server/main.ts --config examples/config --plugins plugins --db .data/dev.db --mock`. These are the flags of the old host `dev` script, with paths made root-relative.
  2. The `vite` dev server.
  3. `node scripts/build-plugins.mjs --watch`.

  On SIGINT/SIGTERM or any child exit, it kills all three and exits with the first non-zero code.
- [X] T023 [P] Delete `packages/` if it is now empty. Then grep the repo (excluding `specs/`, `node_modules`, `.specify`) for `packages/`, `@opsdash/host`, `@opsdash/web` and `@opsdash/delivery-cells`, and fix every remaining hit (for example `biome.json`, comments and scripts).
- [X] T024 Checkpoint: run `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm size`. All must pass, with the same test count as `baseline.md`. Fix regressions before continuing.

**Checkpoint**: The layout and single manifest are in place, and everything is green.

---

## Phase 3: User Story 1 - Set up and run on a fresh machine (Priority: P1) 🎯 MVP

**Goal**: A machine with only mise gets from clone to a running mock dashboard, and a wrong runtime or tool fails clearly (FR-003, FR-004, SC-001).

**Independent Test**: quickstart.md §1 and §2.

- [X] T025 [P] [US1] Create `tests/contract/toolchain.test.ts`. It asserts that:
  - the `pnpm` version in `mise.toml` equals the version in `package.json` `packageManager`;
  - the `node` version in `mise.toml` satisfies `engines.node` (use `semver.satisfies`);
  - `pnpm-workspace.yaml` has `engineStrict: true`;
  - `devEngines.packageManager.name` is `pnpm` (contracts/layout.md check 6).
- [X] T026 [US1] Rewrite the "Quick start" in `README.md`:
  - The prerequisite is mise. Where no prebuilt SQLite binary exists, a C/C++ toolchain and Python are also needed.
  - The steps are `mise install`, `pnpm install`, `pnpm build`, `pnpm mock`.
  - Remove `corepack enable`.
  - Add one line for people who don't use mise: install Node 24.21 and pnpm 10.34.5 by hand.
- [X] T027 [US1] Check the FR-004 layers by hand and record the actual error messages under research.md R2:
  - `mise exec node@22 pnpm@10.34.5 -- pnpm install` must fail with an unsupported-engine error that names `>=24.21`.
  - `npm install` must be refused by `devEngines`, and no `package-lock.json` may be created (delete one if it was).

  If `engineStrict` does not stop the root project, add `scripts/check-runtime.mjs` as a `preinstall` script. It compares `process.versions.node` against `engines.node` and exits 1 with that message. Record the fallback in R2.
- [X] T028 [US1] Run quickstart.md §1 on `debian:bookworm` and on `alpine`, and §2, in clean containers. Record the elapsed time and the command count in `specs/003-consolidate-project-structure/baseline.md`. If Docker isn't available, record that the step was skipped, and run §1 in a fresh clone with a fresh `node_modules` instead.

**Checkpoint**: US1 is met. This is the MVP.

---

## Phase 4: User Story 2 - Manage dependencies in one place (Priority: P2)

**Goal**: One dependency declaration, each library once and at one version, and every check runs from the root (FR-001, FR-002, FR-006, SC-002, SC-003).

**Independent Test**: quickstart.md §3 and §4.

- [X] T029 [P] [US2] Create `tests/contract/layout.test.ts` with checks 1–5 from contracts/layout.md:
  1. Only the root `package.json` has `dependencies` or `devDependencies`. Walk the repo and skip `node_modules`, `tests/.tmp`, `.data`, `dist` and `specs`.
  2. No package is in both root lists.
  3. `sdk/package.json` keys are a subset of the allowed fields, and each `peerDependencies` range is satisfied (via `semver.satisfies`) by the `version` in `node_modules/<pkg>/package.json`.
  4. Each `plugins/<id>/` has `plugin.json` and no `package.json`, `vite.config.*`, `tsconfig.json` or `node_modules`.
  5. `packages/` doesn't exist, and `pnpm-workspace.yaml` has no `packages` key.
- [X] T030 [US2] Run `pnpm why zod`, `pnpm why preact`, `pnpm why vite` and `pnpm why @preact/signals`, and confirm each resolves to one version. If one doesn't, align the ranges in the root `package.json` or `sdk/package.json` peers and reinstall.
- [X] T031 [US2] Run quickstart.md §4 (the full suite from the root) and confirm it passes.

**Checkpoint**: US2 is met.

---

## Phase 5: User Story 3 - One application with a conventional layout (Priority: P2)

**Goal**: The server, client and shared areas are enforced by the type check, plugins can't reach into `src/`, the layout is documented, and a new plugin needs no build files (FR-007, FR-015–FR-017, SC-005, SC-008).

**Independent Test**: quickstart.md §5 and §6, and the README layout section.

- [X] T032 [P] [US3] Create `src/shared/api-types.ts` and move into it the type-only declarations from `src/client/api.ts`: `DashboardSummary`, `ConfigError`, `DashboardTheme`, `WidgetStatus`, `ResolvedItem`, `ResolvedDashboard`, `Meta`, `WidgetData` and `ActionResult`.
  - Keep the functions (`getJson`, `runAction`, `widgetUrl`) in `src/client/api.ts`, and update every client import to use `../shared/api-types.ts` (with the right relative depth).
  - In `src/server/config/resolve.ts`, replace the local `WidgetStatus` with an import from `../../shared/api-types.ts`.
  - Don't merge server-internal types that differ from the wire types (for example the server's `ResolvedItem`/`WidgetInstance`).
- [X] T033 [US3] Create `src/shared/tsconfig.json`: `include ["."]`, `lib ["es2024"]`, `types []`.
- [X] T034 [US3] Convert every tsconfig to composite project references (research R4 table):
  - Each of `sdk`, `src/shared`, `src/server`, `src/client`, `plugins` and `tests` gets `composite: true`, `declaration: true`, `emitDeclarationOnly: true` and `outDir: "<repo>/node_modules/.cache/tsc/<name>"`.
  - References: `src/server` and `src/client` reference `src/shared` and `sdk`; `plugins` references `sdk`; `tests/tsconfig.json` includes `tests`, `scripts` and the root config files, and references all the others.
  - The root `tsconfig.json` becomes `{ "files": [], "references": [ …all six… ] }`.
  - Set `package.json` `typecheck` to `tsc -b`.
- [X] T035 [US3] Check the boundary with quickstart.md §5: a client→server import and a plugin→`src/server` import must each fail `pnpm typecheck` with TS6307. Revert the probe edits afterwards.
  - If declaration emit produces errors that aren't real (for example TS2742) that can't be fixed with small explicit type annotations, use the R4 fallback instead. Revert to the T017 per-area tsconfigs and `typecheck` script, and add Biome `noRestrictedImports` in `biome.json` `overrides`: for `src/client/**`, the pattern `**/server/**`; for `plugins/**` and `plugin-lib/**`, the patterns `**/src/server/**`, `**/src/client/**` and `**/src/shared/**`. Each gets a message naming the rule.
  - Record the option used under research.md R4, and update contracts/layout.md if the fallback was taken.
- [X] T036 [P] [US3] Add a "Project layout" section to `README.md`:
  - The tree from plan.md ("Source Code"), with one line of purpose for each of `src/server`, `src/client`, `src/shared`, `sdk`, `plugin-lib`, `plugins/<id>`, `drizzle`, `tests/*`, `scripts`, `config` and `examples`.
  - A "where to find" list for config validation (`src/server/config/`), the dashboard grid (`src/client/grid/`), plugin loading (`src/server/plugins/`), the refresh cycle (`src/server/refresh/`) and storage (`src/server/store/`).
- [X] T037 [US3] Run quickstart.md §6: add `plugins/sample` from the reference plugin using only `src/` and `plugin.json`, build it, confirm it loads (`sample: loaded` in `/api/status`) and that `layout.test.ts` still passes, then delete `plugins/sample`.

**Checkpoint**: US3 is met.

---

## Phase 6: User Story 4 - Third-party plugins keep working (Priority: P3)

**Goal**: A plugin that has its own `package.json` (`opsdash` field) and `vite.config.ts` still builds with the SDK and loads unchanged (FR-010, SC-007).

**Independent Test**: quickstart.md §7.

- [X] T038 [P] [US4] Create `sdk/tests/manifest-source.test.ts` for `readManifestSource` (from T011). Use temp dirs to check that:
  - a `plugin.json` and an equivalent `package.json` + `opsdash` produce identical results;
  - `plugin.json` wins when both exist;
  - having neither throws the exact message from contracts/plugin-manifest.md;
  - a missing `version` throws.
- [X] T039 [US4] Rewrite `tests/contract/copy-plugin.test.ts` so it builds the copy in the **third-party shape**:
  - Copy `plugins/reference/src` into `tests/.tmp/copy-<pid>/plugins/copy/src`.
  - Write `package.json` `{ name: "@acme/opsdash-copy", version: "1.0.0", type: "module", opsdash: { ...fields from plugins/reference/plugin.json except name/version, id: "copy" } }`.
  - Write `vite.config.ts` as `import { opsdashPlugin } from "@opsdash/plugin-sdk/vite"; import { defineConfig } from "vite"; export default defineConfig({ plugins: [opsdashPlugin()] });`.
  - Build with `node <ROOT>/node_modules/vite/bin/vite.js build --logLevel error` (cwd = copy dir; resolution walks up to the root `node_modules`).
  - Remove the old `node_modules` symlink step.
  - Keep the existing assertions: `copy:loaded`, `reference:loaded`, widget data ok, and `Copy of ` in `client.js`.
- [X] T040 [P] [US4] Update `sdk/README.md` with a "Building a plugin outside this repository" section:
  - a `package.json` with an `opsdash` field (link to the field list in `specs/002-delivery-tracker/contracts/plugins.md`);
  - devDependencies `@opsdash/plugin-sdk`, `vite`, `zod` and `preact`, which match the SDK's peer ranges;
  - a `vite.config.ts` using `opsdashPlugin()`;
  - `vite build`, then copying the plugin folder with its `dist/` into the host's plugins directory.

  Also note that `plugin.json` is accepted in place of the `opsdash` field.

**Checkpoint**: All user stories are met.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T041 [P] Create `MIGRATION.md` at the repo root (FR-014):
  - the path map from data-model.md;
  - the command changes from contracts/commands.md ("Before" column);
  - `#delivery-cells` replacing `@opsdash/delivery-cells`;
  - plugin `package.json` → `plugin.json`;
  - the one-time cleanup: `rm -rf packages plugins/*/node_modules node_modules && mise install && pnpm install`.
- [X] T042 [P] Update the rest of `README.md`:
  - the "Running" and "Development" sections: `pnpm dev` now starts all three processes; the plugins section mentions `plugin.json`;
  - replace any `packages/…` path;
  - link `MIGRATION.md`.
- [X] T043 Run quickstart.md §8 (dev mode: client HMR, server restart, plugin rebuild, Ctrl-C stops all) and §9:
  - Clean build time must be ≤ 1.1 × the baseline.
  - The stale-layout hint must appear in a checkout that still has `packages/`.

  Record the results in `baseline.md`, and fix anything that fails.
- [X] T044 Final gate: run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm size && pnpm perf:coldstart`. Everything must pass and stay within budgets. Test counts must equal the baseline plus the new tests (toolchain, layout, manifest-source).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001–T003)**: T001 first. T002 must run before any change in Phase 2. T003 is independent.
- **Foundational (T004–T024)**: after T002. It blocks every story.
- **US1 (T025–T028)**, **US2 (T029–T031)**, **US3 (T032–T037)** and **US4 (T038–T040)**: each needs only Phase 2, so they can run in parallel. The only overlap is `README.md`, touched by T026 and T036, so do those one after the other.
- **Polish (T041–T044)**: after all stories.

### Within Phase 2

- T004–T007 (moves) come first. T005, T006 and T007 can run in parallel after T004.
- T008, T009 and T010 come after the moves.
- T011 must be done before T012 deletes the plugin `package.json` files. T013 depends on T011.
- T014 and T015 come before T016 (install).
- T017–T023 come after T016.
- T024 is last.

### Within stories

- US3: T032 → T033 → T034 → T035. T036 and T037 can run anywhere in US3.
- US4: T038 needs T011. T039 needs T012 and T013.

## Parallel Examples

```text
# Phase 2, after T004:
T005 delivery-cells move | T006 host move | T007 web move

# Phase 2, after T016:
T017 tsconfigs | T018 vitest config | T019 playwright + size-limit | T021 coldstart

# After T024, one per developer:
US1: T025 → T026 → T027 → T028
US2: T029 → T030 → T031
US3: T032 → T033 → T034 → T035 (+ T036, T037)
US4: T038 | T039 | T040
```

## Implementation Strategy

- **MVP**: Phase 1 + Phase 2 + US1. After that, a fresh machine with mise builds and runs, and the "pnpm/vite missing" problem is solved.
- **Quick fix before the refactor, if it's needed urgently**: T003, the `engines`/`devEngines`/`packageManager` fields from T015 and the `engineStrict` line from T016 can be applied to the current layout on their own, with `vite` added to the root `devDependencies`. They fix the reported failure before any files move.
- **Then**: US2 (guard tests), US3 (boundaries, shared types, layout docs), US4 (third-party guarantee), then Polish.
- Commit after each task or logical group, keeping `git mv` commits separate from content edits so history follows the moved files.

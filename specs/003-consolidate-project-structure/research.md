# Research: Consolidate Project Structure

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-28

Each entry records the decision, why it was chosen, and what else was considered. The "today"
facts come from the repository at commit `1743205`.

## R1. Package manager: keep pnpm, pinned in `mise.toml`

**Decision** (user, 2026-09-28): Keep pnpm 10 and add it to `mise.toml` next to Node, as
`"npm:pnpm" = "10.33.0"`. `package.json` `packageManager` is `pnpm@10.33.0`, and a contract test
checks that the two match.

**Amended 2026-09-28, after implementation.**

- **Backend.** The first pin, `pnpm = "10.34.5"`, used mise's default `aqua:pnpm/pnpm` backend. That
  backend downloads the standalone glibc binary, which can't run on the Alpine (musl) dev container:
  `couldn't exec process: No such file or directory`. The `npm:` backend installs pnpm's JS package
  and runs it on the pinned Node, so it works on musl and glibc alike.
- **Version.** mise's npm trust policy refused 10.34.5 (`trust downgrade … earlier published version
  had trusted publisher but this version has no trust evidence`). The registry shows 10.34.0 and
  10.34.5 published by `pnpmuser <publish-bot@pnpm.io>` without provenance, whereas 10.20.0–10.33.0
  were published by GitHub Actions with SLSA provenance. The user chose 10.33.0, the last release
  with provenance, instead of bypassing the check.
- **Corepack links.** A machine that previously ran `corepack enable` has a `pnpm` link inside Node's
  `bin/`, and that link shadows mise's pnpm. Run `corepack disable` once to remove it (see
  MIGRATION.md).

`pnpm-lock.yaml` stays. `pnpm-workspace.yaml` stays, but only for settings
(`onlyBuiltDependencies: [better-sqlite3, esbuild]`, `engineStrict: true`): its `packages:` list
is removed because there are no workspace packages anymore. Corepack is no longer involved.

**Rationale**:
- The failure on the other machine had two causes. pnpm wasn't installed, and Vite was declared
  only inside individual packages, not at the root.
- `mise install` now provisions pnpm together with Node, so FR-003 is met with the tool-version
  manager as the only manual prerequisite.
- The single root manifest (R5) puts Vite in the root `devDependencies`.
- pnpm keeps its strict `node_modules`, which catches undeclared imports, and its reliable
  handling of platform-specific optional binaries (Rolldown, Lightning CSS, esbuild).
- Pinning pnpm with mise instead of corepack avoids depending on corepack, which is deprecated
  and no longer ships with Node from 25 on.

**Alternatives considered**:
- *npm, bundled with Node*: fewer tools, but the user chose to keep pnpm. npm also has a history
  of lockfiles that miss platform-specific optional binaries.
- *pnpm through corepack*: this is the extra activation step that was missed on the other
  machine, and it relies on a deprecated tool.

## R2. Enforcing runtime and package-manager versions (FR-004)

**Decision**: Four layers, each one standard:

1. `mise.toml` pins the exact `node` and `pnpm` versions, so `mise install` provisions both.
2. `package.json` has `engines.node: ">=24.21"`, and `pnpm-workspace.yaml` has
   `engineStrict: true`. pnpm refuses to install with a Node version that doesn't match, and
   names the required range.
3. `package.json` `packageManager: "pnpm@10.33.0"`. pnpm's default `packageManagerStrict` refuses
   a different package manager name, and warns on a different pnpm version.
4. `package.json` `devEngines.packageManager: { name: "pnpm", onFail: "error" }`. With this,
   `npm install` fails immediately instead of producing a second, wrong lockfile.

**Rationale**: All of these are built-in mechanisms, so no script is needed. A task checks that
each one fails with a clear message: wrong Node under pnpm, npm used instead of pnpm, and pnpm
missing when mise hasn't been run. In the last case the shell's own "command not found" is
acceptable, because the README's first step is `mise install`.

**Alternatives considered**: a `preinstall` script that compares versions by hand. This is kept
only as a fallback if `engineStrict` doesn't apply to the root project. A task checks this.

**Verified 2026-09-28 (T027)**, in a scratch copy of the manifests:
- With `engines.node` set to `>=99` under Node 24.21, `pnpm install` exits 1 with
  `ERR_PNPM_UNSUPPORTED_ENGINE  Unsupported environment (bad pnpm and/or Node.js version)`,
  `Expected version: >=99`, `Got: v24.21.0`. `engineStrict` therefore applies to the root
  project, and the `preinstall` fallback isn't needed.
- `npm install` exits 1 with
  `EBADDEVENGINES … Invalid name "pnpm" does not match "npm" for "packageManager"`, and no
  `package-lock.json` or `node_modules` is written.

## R3. Merging host and web into one application

**Decision**: Use one source tree, `src/`, with three areas:

| Area | From | Runs in |
|------|------|---------|
| `src/server/` | `packages/host/src/**` | Node |
| `src/client/` | `packages/web/src/**`, `index.html`, `public/` | Browser |
| `src/shared/` | Type-only HTTP/SSE payload types, now in `packages/web/src/api.ts` and mirrored on the host | Both |

The Vite root is `src/client`. The web build output moves from `packages/web/dist` to
`dist/web`. `DEFAULT_WEB_DIR` in `src/server/server.ts` changes to match.

**Rationale**:
- The two halves never import each other today; both import only the SDK. Merging them removes
  two package boundaries and two sets of tsconfig and build files without changing any runtime
  code path.
- The split between server, client and shared code was chosen with the user (spec Assumptions,
  2026-09-28).
- `src/shared/` starts out containing only types that both sides already declare. The
  `DashboardSummary`, `ConfigError`, `ResolvedItem` and similar types move there, so the wire
  contract has one definition.

**Alternatives considered**: grouping by feature with `*.server.ts`/`*.client.tsx` suffixes, and
a flat `src/` with no boundary. The user rejected both (spec Assumptions).

## R4. Enforcing the browser/server boundary (FR-016, FR-017)

**Decision**: Use TypeScript project references. Each area is a `composite` project whose
`include` lists only its own files:

| Project | Includes | References |
|---------|----------|------------|
| `sdk/tsconfig.json` | `sdk/src` | none |
| `src/shared/tsconfig.json` | `src/shared` | none |
| `src/server/tsconfig.json` | `src/server` | shared, sdk |
| `src/client/tsconfig.json` | `src/client` | shared, sdk |
| `plugins/tsconfig.json` | `plugins/*/src`, `plugins/*/tests`, `plugin-lib` | sdk |
| `tests/tsconfig.json` | `tests`, root config files, `scripts` | all of the above |

A root `tsconfig.json` with `files: []` references them all, so `pnpm typecheck` is
`tsc -b`. A composite project that imports a file outside its `include` fails with TS6307
("File … is not listed within the file list of project"). A client file that imports
`src/server/**`, or a plugin that imports `src/**`, therefore breaks the type check. Composite
projects must emit, so each one uses `emitDeclarationOnly` with output under
`node_modules/.cache/tsc/<project>`.

**Rationale**: This is the standard TypeScript mechanism. It shows up in the editor as well as
in CI, and TS 7.0.2 (the installed version) supports `tsc -b`.

**Verified 2026-09-28 (T035)**: the project-reference option works. `tsc -b` finishes in about
2 s with no false positives from declaration emit. A probe import of `src/server/log.ts` from
`src/client/main.tsx` fails with
`TS6307: File '…/src/server/log.ts' is not listed within the file list of project '…/src/client/tsconfig.json'`,
and the same import from `plugins/reference/src/client.tsx` fails in the same way for
`plugins/tsconfig.json`. The fallback below was not needed. Client unit tests
(`tests/client`) belong to the client project (`rootDir: "../.."`), so they get the browser
types. Every other test belongs to `tests/tsconfig.json`.

**Fallback**: If declaration emit produces many errors that aren't really problems (for example
TS2742, "inferred type cannot be named"), use plain per-area tsconfigs instead. The boundary
then moves to Biome's `noRestrictedImports` with `patterns` (available in the installed Biome
2.5.14), scoped through `overrides` to `src/client/**` and `plugins/**`. Tasks must record which
option was used.

## R5. Plugin SDK location and how it is resolved

**Decision**: Move `packages/plugin-sdk` to `sdk/`. It keeps a minimal `sdk/package.json`
(publishing manifest) with `name`, `version`, `type`, `exports` and `peerDependencies`, and no
`dependencies` or `devDependencies`. The root declares
`"@opsdash/plugin-sdk": "link:./sdk"`, so pnpm symlinks `node_modules/@opsdash/plugin-sdk` to `sdk/`.
`sdk/` has no `node_modules` of its own. Its imports of `zod`, `preact` and `vite` resolve by
walking up to the root `node_modules`, where all three are direct dependencies.

**Rationale**:
- Third-party plugins import `@opsdash/plugin-sdk`, `…/client` and `…/vite`. FR-010 and SC-007
  require that source to keep working unchanged, so the specifier and export map must stay.
- Node runs the server TypeScript directly (type stripping) and ignores tsconfig `paths`. A real
  `node_modules` entry is the only resolution that works for Node, Vite, Vitest and tsc alike.
- The spec's Assumptions allow the SDK a minimal description of its own. Moving `zod`, `preact`
  and `vite` to `peerDependencies` keeps the root as the only place that installs anything.
  npm 7+ and pnpm 8+ auto-install peers, so external authors get them without any extra step.

**Alternatives considered**:
- *Subpath import `#opsdash/plugin-sdk`*: would change every plugin's source and break
  third-party plugins.
- *tsconfig `paths` + Vite alias*: doesn't work for Node at runtime.
- *Keeping `sdk` as a pnpm workspace package*: behaves the same as `link:`, but brings back
  the workspace configuration and a place for per-package dependencies.
- *`file:` instead of `link:`*: pnpm copies (hard-links) `file:` directories, so edits to
  `sdk/src` wouldn't show up without reinstalling.

This remaining second `package.json` is recorded in the plan's Complexity Tracking.

## R6. Plugin-shared UI (`delivery-cells`)

**Decision**: Move `packages/delivery-cells` to `plugin-lib/delivery-cells/`, and import it as
`#delivery-cells` through the `imports` field of the root `package.json`.

**Rationale**:
- FR-017 puts shared plugin UI on the plugin side, outside `src/`.
- It can't go under `plugins/`, because the host treats every directory there as a plugin and
  refuses one that has no manifest (`PluginRegistry.pluginDirs`), which would turn health to
  `degraded`. Changing that rule would change runtime behaviour (FR-012).
- It doesn't belong in the SDK either: it is specific to the delivery domain, and putting it in
  the SDK would grow the public plugin API.
- Subpath imports resolve natively in Node, TypeScript (`nodenext`/`bundler`) and Vite, with no
  alias configuration. Only the five delivery-family plugins (`delivery`, `github`, `jenkins`,
  `jira`) use it, and plugin client builds bundle it in (it isn't a shared import-map module),
  so plugin output is unchanged.

**Alternatives considered**: `plugins/_shared` (refused by the registry), and moving it into
`sdk/` (grows the public API).

## R7. Plugin manifest without a per-plugin `package.json` (FR-008)

**Decision**: Each built-in plugin declares its metadata in `plugins/<id>/plugin.json`: `name`,
`version`, and the current `opsdash` fields at top level (see
[contracts/plugin-manifest.md](./contracts/plugin-manifest.md)). The SDK preset
`opsdashPlugin()` reads `plugin.json` when it exists, and otherwise falls back to
`package.json` → `{ name, version, opsdash }`. The fallback is what keeps third-party plugins
working (FR-010).

**Rationale**: `package.json` does two jobs today: dependency declaration and plugin metadata.
Splitting them lets the dependency job move to the root. The built artefact the host reads
(`dist/opsdash.manifest.json`) stays byte-for-byte the same shape, so the host and deployed
plugins are unaffected.

**Alternatives considered**: declaring metadata inside `definePlugin()` in `server.ts`. That
would mean the static manifest can only be produced by running plugin code, which is a bigger
API change. It is left for a future plugin-API version.

## R8. One build and dev command (FR-005, FR-013)

**Decision**:
- `pnpm build` → `vite build && node scripts/build-plugins.mjs`. The first builds
  `src/client` into `dist/web`.
- `scripts/build-plugins.mjs` finds every `plugins/*` directory with a `plugin.json` or
  `package.json` and calls Vite's `build()` for each with
  `{ root: dir, configFile: false, plugins: [opsdashPlugin()] }`. It uses the plugin's own
  `vite.config.ts` instead only if one exists. Plugins build in parallel (`Promise.all`) to meet
  SC-006. Per-plugin `vite.config.ts` files are deleted.
- `pnpm dev` → `scripts/dev.mjs` starts three child processes with prefixed output and
  shared shutdown:
  1. The server, with `node --watch-path=src/server --watch-path=src/shared --watch-path=sdk/src`.
  2. The Vite dev server on :5173.
  3. `build-plugins.mjs --watch`.

**Rationale**: No new dependency is needed (Principle IV). `scripts/opsdash.mjs` already uses
this spawn pattern, and the script is about 30 lines.

**Alternatives considered**: `concurrently` or `npm-run-all2`, a new dependency that would only
replace about 30 lines. Also Vite 8 multi-environment builds, which don't fit the per-plugin
output layout the host reads.

## R9. Tests layout

**Decision**:

| Today | New |
|-------|-----|
| `packages/host/tests/{unit,integration}`, `helpers.ts`, `dump-fixtures.ts` | `tests/server/…` |
| `packages/web/tests/unit` | `tests/client/unit` |
| `plugins/delivery/tests` | stays next to the plugin |
| `tests/contract`, `tests/e2e`, `tests/fixtures` | unchanged |

`vitest.config.ts` defines the projects `server`, `client` (happy-dom and the Preact preset,
inlined from `packages/web/vitest.config.ts`), `plugins` (`plugins/*/tests`), `sdk` and
`contract`. `tests/contract/copy-plugin.test.ts` is rewritten to build the copied plugin in the
**third-party shape**: its own `package.json` with an `opsdash` field and a `vite.config.ts`.
This way it covers US4 and SC-007 instead of relying on the removed `plugins/reference/node_modules`.
A new `tests/contract/layout.test.ts` checks SC-002/003/005:

- only one `package.json` declares `dependencies` or `devDependencies`;
- no plugin directory contains `package.json`, `vite.config.ts` or `tsconfig.json`;
- `sdk/package.json` has no `dependencies`, and its peer ranges are satisfied by the versions
  installed at the root.

## R10. Migrations and the drizzle config

**Decision**: Move `packages/host/drizzle/` to `drizzle/` at the root, and
`packages/host/drizzle.config.ts` to the root `drizzle.config.ts` (with `schema: ./src/server/store/schema.ts`).
`MIGRATIONS_DIR` becomes `join(import.meta.dirname, "../../../drizzle")`. The migration files
are moved unchanged, so journal hashes and existing databases are unaffected (FR-012).

## R11. Stale checkouts and old paths (spec edge cases, FR-014)

**Decision**:
- `scripts/opsdash.mjs checkBuilt()` looks for `dist/web/index.html` and a built manifest in each
  plugin, and tells the user to run `pnpm build`.
- If it finds `packages/` or any `plugins/*/node_modules`, it prints a one-line hint to delete
  them together with the root `node_modules`, then run `pnpm install`.
- `MIGRATION.md` at the repository root lists every old path and its new path, every changed
  command (`pnpm --filter … x` → `pnpm x`, plus the new `mise install` first step), and the
  one-time cleanup.
- `--plugins plugins` and the default config paths don't change, so deployments that use the
  documented start commands need no edits.

## Dependency justification

No runtime or development dependency is added. The only tooling change is that pnpm is pinned
in `mise.toml` instead of being activated through corepack. `@preact/preset-vite`, `@testing-library/preact`, `happy-dom`, `vite` and
`drizzle-kit` move from the web and host manifests to the root `devDependencies`. The host's
`dependencies` become the root `dependencies`, at the same versions. Where two manifests declared
the same library, the higher of the existing ranges is kept. Today those ranges are all identical
(`preact ^10.29.8`, `vite ^8.3.1`, `zod ^4.6.5`, `semver ^7.8.5`, `@preact/signals ^2.11.2`).

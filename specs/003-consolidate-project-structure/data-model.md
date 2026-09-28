# Data Model: Consolidate Project Structure

**Feature**: [spec.md](./spec.md) | **Date**: 2026-09-28

This feature does not change runtime data: the SQLite schema, config format and HTTP payloads
stay the same. Its "entities" are the project's structural artefacts. The spec's Key Entities
map to them as follows.

## Application (spec: Application)

The single Opsdash product. It merges the former `@opsdash/host` and `@opsdash/web` packages.

| Area | Path | Runs in | May import |
|------|------|---------|------------|
| server | `src/server/` | Node | `src/shared`, `@opsdash/plugin-sdk`, npm packages, `node:*` |
| client | `src/client/` | browser | `src/shared`, `@opsdash/plugin-sdk/client` (types), npm packages. **Not** `src/server` |
| shared | `src/shared/` | both | type-only declarations and pure code. **Not** `node:*`, DOM or `src/server`/`src/client` |

**Rules**: FR-015 and FR-016. The type check enforces them (research R4).

## Component (spec: Component)

| Component | Path | Own manifest | Built output |
|-----------|------|--------------|--------------|
| Application | `src/` | none (root `package.json`) | `dist/web/` (client). The server runs from source |
| Plugin SDK | `sdk/` | `sdk/package.json`: publishing only | none (ships TS sources, as today) |
| Plugin-shared UI | `plugin-lib/delivery-cells/` | none | bundled into each plugin's client |
| Built-in plugin | `plugins/<id>/` | `plugin.json`: plugin metadata only | `plugins/<id>/dist/{client.js,server.js,style.css,opsdash.manifest.json}` |

**Rules**:
- A component other than `sdk/` MUST NOT contain `package.json`, `package-lock.json`,
  `node_modules/`, `vite.config.*` or `tsconfig.json`. The one exception is
  `plugins/tsconfig.json`, which is shared by all plugins. This rule is checked by
  `tests/contract/layout.test.ts` (SC-005).
- Plugins MUST NOT import from `src/**` (FR-017).

## Plugin manifest (spec: Plugin manifest)

Source: `plugins/<id>/plugin.json`. Field list and fallback rules:
[contracts/plugin-manifest.md](./contracts/plugin-manifest.md).

State flow, unchanged apart from the first step:

```text
plugin.json (or package.json.opsdash) ──SDK preset build──▶ dist/opsdash.manifest.json ──host checkManifest()──▶ loaded | refused
```

**Validation**: the host's existing `checkManifest` rules still apply to the built manifest. At
build time the preset fails if neither `plugin.json` nor `package.json` with an `opsdash` field
exists, or if `name` or `version` is missing.

## Project dependency declaration (spec: Project dependency declaration)

Root `package.json`:

| Field | Content |
|-------|---------|
| `name` / `private` / `type` | `opsdash`, `true`, `module` |
| `bin` | `{ "opsdash": "src/server/main.ts" }` |
| `engines` | `{ "node": ">=24.21" }`, enforced by `engineStrict: true` in `pnpm-workspace.yaml` |
| `packageManager` | `pnpm@10.33.0` (must equal the `pnpm` pin in `mise.toml`) |
| `devEngines` | `packageManager: { name: "pnpm", onFail: "error" }`, so that `npm install` is refused |
| `imports` | `{ "#delivery-cells": "./plugin-lib/delivery-cells/index.tsx" }` |
| `dependencies` | the former host dependencies, plus `preact` and `@preact/signals` for the client, plus `"@opsdash/plugin-sdk": "link:./sdk"` |
| `devDependencies` | the former root, web, host, SDK and plugin dev dependencies (vite, @preact/preset-vite, drizzle-kit, vitest, happy-dom, @testing-library/preact, playwright, biome, typescript, size-limit, @types/*) |
| `scripts` | see [contracts/commands.md](./contracts/commands.md) |

**Rules**:
- Every third-party package appears exactly once across `dependencies` and `devDependencies`
  (SC-003).
- `sdk/package.json` may only have `name`, `version`, `type`, `description`, `license`,
  `exports`, `files` and `peerDependencies`. Each peer range must be satisfied by the version
  installed at the root. `layout.test.ts` checks both.

## Path map

Old path to new path. `MIGRATION.md` reproduces this for contributors.

| Old | New |
|-----|-----|
| `packages/host/src/**` | `src/server/**` |
| `packages/host/tests/**` | `tests/server/**` |
| `packages/host/drizzle/` | `drizzle/` |
| `packages/host/drizzle.config.ts` | `drizzle.config.ts` |
| `packages/web/src/**` | `src/client/**` (wire types → `src/shared/api-types.ts`) |
| `packages/web/index.html`, `public/` | `src/client/index.html`, `src/client/public/` |
| `packages/web/vite.config.ts`, `vitest.config.ts` | root `vite.config.ts`, and the `client` project in root `vitest.config.ts` |
| `packages/web/tests/**` | `tests/client/**` |
| `packages/web/dist/` | `dist/web/` |
| `packages/plugin-sdk/**` | `sdk/**` |
| `packages/delivery-cells/src/**` | `plugin-lib/delivery-cells/**` |
| `plugins/<id>/package.json` | `plugins/<id>/plugin.json` (metadata only) |
| `plugins/<id>/vite.config.ts`, `tsconfig.json` | removed (`scripts/build-plugins.mjs`, `plugins/tsconfig.json`) |
| `pnpm-workspace.yaml` `packages:` list | removed (the file keeps settings only) |
| `mise.toml` | adds `"npm:pnpm" = "10.33.0"` |
| `import … from "@opsdash/delivery-cells"` | `import … from "#delivery-cells"` |

Paths computed at runtime that must be updated:

- `DEFAULT_WEB_DIR` in `src/server/server.ts` → `../../dist/web`
- `MIGRATIONS_DIR` in `src/server/store/db.ts` → `../../../drizzle`
- `REPO` in `tests/server/helpers.ts`
- `REFERENCE_DIST` in `tests/fixtures/plugins/variants.ts` (unchanged)
- `HOST` and `checkBuilt()` in `scripts/opsdash.mjs`
- `scripts/coldstart.mjs`
- `webServer.command` in `playwright.config.ts`

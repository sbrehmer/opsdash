# Migrating to the single-project layout

Opsdash used to be a pnpm workspace with ten `package.json` files. It is now one project. The host
and the web UI are merged into `src/`, the plugin SDK lives in `sdk/`, and plugins keep only their
sources and a `plugin.json`. Runtime behaviour, the config format, the database schema and the
plugin API are unchanged.

## One-time cleanup in an existing checkout

```bash
rm -rf packages plugins/*/node_modules node_modules
corepack disable    # removes corepack's pnpm link from Node's bin/, which would shadow mise's pnpm
mise install        # now also installs the pinned pnpm (no more corepack enable)
pnpm install
pnpm build
```

Existing databases keep working: the migration files moved to `drizzle/` unchanged.

## Paths

| Old | New |
|-----|-----|
| `packages/host/src/**` | `src/server/**` |
| `packages/host/tests/**` | `tests/server/**` |
| `packages/host/drizzle/`, `packages/host/drizzle.config.ts` | `drizzle/`, `drizzle.config.ts` |
| `packages/web/src/**` | `src/client/**`. Payload types are now in `src/shared/api-types.ts` |
| `packages/web/index.html`, `packages/web/public/` | `src/client/index.html`, `src/client/public/` |
| `packages/web/tests/**` | `tests/client/**` |
| `packages/web/dist/` (built UI) | `dist/web/` |
| `packages/web/vite.config.ts`, `vitest.config.ts` | root `vite.config.ts`, and the `client` project in root `vitest.config.ts` |
| `packages/plugin-sdk/**` | `sdk/**` (still published and imported as `@opsdash/plugin-sdk`) |
| `packages/delivery-cells/src/**` | `plugin-lib/delivery-cells/**`, imported as `#delivery-cells` instead of `@opsdash/delivery-cells` |
| `plugins/<id>/package.json` | `plugins/<id>/plugin.json`: `name`, `version` and the former `opsdash` fields at top level |
| `plugins/<id>/vite.config.ts`, `tsconfig.json` | removed. `scripts/build-plugins.mjs` and `plugins/tsconfig.json` cover every plugin |
| `pnpm-workspace.yaml` `packages:` | removed. The file keeps only settings |

## Commands

The command names are unchanged. What changed:

| Before | Now |
|--------|-----|
| `corepack enable` | `mise install` (pnpm is pinned in `mise.toml`) |
| `pnpm --filter @opsdash/web --filter "./plugins/*" run build` | `pnpm build` |
| `pnpm -r --parallel run dev` | `pnpm dev` (server, Vite and plugin watch builds in one terminal) |
| `pnpm --filter @opsdash/host db:generate` | `pnpm db:generate` |
| `pnpm -r run typecheck && tsc -p tsconfig.json` | `pnpm typecheck` (`tsc -b`, which also enforces the browser/server boundary) |
| `node packages/host/src/main.ts …` | `node src/server/main.ts …` (or `pnpm start …`) |

`pnpm install` now refuses Node versions below 24.21, and `npm install` is refused.

## Third-party plugins

Nothing changes. A plugin with its own `package.json` (`opsdash` field) and a `vite.config.ts` that
uses `opsdashPlugin()` builds and loads as before. See `sdk/README.md`.

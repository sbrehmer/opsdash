# Contract: Root Commands

Every command runs from the repository root. The only manual prerequisite is **mise**. Running
`mise install` provisions the pinned Node (24.21.0) and pnpm (10.33.0) from `mise.toml`. Command
names stay `pnpm <x>`. The behaviour and options of each command are unchanged unless this
contract says otherwise (FR-011). What changes is that no `--filter` or `-r` is needed anywhere.

| Command | Before | Behaviour |
|---------|--------|-----------|
| `mise install` | `corepack enable` (often forgotten) | Installs the pinned Node and pnpm (FR-003). |
| `pnpm install` | same | Installs everything for all components from one lockfile and one manifest. It fails with a message naming the required range if Node doesn't satisfy `engines` (`engineStrict`). `npm install` fails immediately (`devEngines`) (FR-004). |
| `pnpm build` | `pnpm --filter @opsdash/web --filter "./plugins/*" run build` | Builds `src/client` → `dist/web/`, then every plugin under `plugins/` → `plugins/<id>/dist/` (FR-005). A non-zero exit names the component that failed. |
| `pnpm dev` | `pnpm -r --parallel run dev` | In one terminal, starts the server under watch (restarts on `src/server`, `src/shared` or `sdk/src` changes), the Vite dev server on :5173 proxying to :4400, and plugin watch builds. Ctrl-C stops all three (FR-013). |
| `pnpm start <opsdash args>` | same | Same as `node src/server/main.ts <args>`. Its CLI options are unchanged (see README "Running"). |
| `pnpm mock` / `start:dev` / `start:prod` | same | Unchanged. Before starting, the build check looks for `dist/web/index.html` and each plugin's built manifest. If they're missing it prints `Not built yet: <components>. Run \`pnpm build\` first.` |
| `pnpm db:setup` / `db:status` / `db:reset` `<env>` | same | Unchanged. |
| `pnpm config:check <env>` | same | Unchanged. |
| `pnpm db:generate` | `pnpm --filter @opsdash/host db:generate` | Runs `drizzle-kit generate` with the root `drizzle.config.ts`, writing to `drizzle/`. |
| `pnpm test` | same | Runs Vitest across the `server`, `client`, `sdk`, `plugins` and `contract` projects. |
| `pnpm test:e2e` | same | Unchanged (Playwright and axe). |
| `pnpm typecheck` | `pnpm -r run typecheck && tsc -p tsconfig.json` | `tsc -b`. It fails on type errors **and** on imports that cross a boundary (FR-016, FR-017). |
| `pnpm lint` | same | `biome check .`, unchanged. |
| `pnpm size` / `perf:coldstart` / `seed:delivery` | same | Unchanged. The size-limit paths point at `dist/web/`. |

## Stale-layout hint (spec edge case)

If `pnpm build`, `mock` or `start:*` finds `packages/` or any `plugins/*/node_modules`, it
prints a warning and keeps going:

```text
Found files from the old layout (packages/, plugins/*/node_modules).
Remove them and reinstall: rm -rf packages plugins/*/node_modules node_modules && pnpm install. See MIGRATION.md.
```

## Self-preparing start commands (amended 2026-09-28)

`pnpm mock`, `start:dev`, `start:prod`, `db:*`, `config:check` and `pnpm dev` now call
`scripts/prepare.mjs` before doing anything else. It:

- runs `mise install` (when mise is available) and runs pnpm through `mise exec`;
- runs `pnpm install --frozen-lockfile` when `node_modules` is missing, or when the hash of
  `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `sdk/package.json` or `mise.toml`
  changed;
- runs `pnpm build` when the build output is missing, or when the hash of its sources changed.
  Database commands and `pnpm dev` skip this step.

The same start commands are also mise tasks (`mise run mock`, `start:dev`, `start:prod`, `dev`).
mise installs missing tools before it runs a task, so on a new machine `mise run mock` is the only
command needed. When nothing changed, the check takes about 0.1 s.

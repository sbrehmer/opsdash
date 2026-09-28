# Opsdash

A lightweight, plugin-based dashboard for tracking items across external source systems. Dashboards
are defined in YAML files, widgets come from plugins, and every plugin can run against a built-in mock
source.

## Quick start

Requires [mise](https://mise.jdx.dev), which installs the pinned Node.js and pnpm from `mise.toml`.
Where no prebuilt SQLite binary exists for your platform, you also need a C/C++ toolchain and Python.

```bash
mise run mock        # mock mode: no source systems or credentials, sample rows on first start
```

That's the only command. Every start command first brings the checkout up to date. It installs the
pinned Node.js and pnpm (`mise install`), installs dependencies when `package.json` or the lockfile
changed, and rebuilds the web UI and plugins when their sources changed. When nothing changed, these
checks add well under a second.

The same start commands also exist as `pnpm mock`, `pnpm start:dev` and so on, and prepare the
checkout the same way. If you used `corepack enable` before, run `corepack disable` once so that
mise's pnpm is used. Without mise, install Node.js 24.21 and pnpm 10.33.0 yourself. `pnpm install`
refuses other Node versions, and `npm install` is refused outright.

Then open http://localhost:4400.

## Environments

Each environment has a config template in `config/` that shares the dashboards in `config/dashboards/`:

| Environment | Config | Secrets | Start |
|-------------|--------|---------|-------|
| mock | `config/mock.yaml` | none | `mise run mock` or `pnpm mock` |
| development | `config/development.yaml` | `config/env/development.env` (copy the `.example`) | `mise run start:dev` or `pnpm start:dev` |
| production | `config/production.yaml` | `config/env/production.env`, or the service environment | `mise run start:prod` or `pnpm start:prod` |

Every start command:

1. installs the pinned tools and the dependencies, and builds the web UI and plugins, when any of
   them is missing or out of date (`scripts/prepare.mjs`);
2. creates or migrates the environment's database (`.data/<env>.db`);
3. loads the env file if it exists, and starts the server.

A fresh mock database is seeded with sample Delivery rows. To add another environment, add
`config/<name>.yaml`; the same commands then work with `<name>`.

| Command | Purpose |
|---------|---------|
| `pnpm config:check <env>` | Validates the config, plugins and required secrets without starting. The exit code is non-zero on problems. |
| `pnpm db:setup <env>` | Creates the database, or applies pending migrations. Run it as a deploy step before `start:prod`. |
| `pnpm db:status <env>` | Shows the schema version and how many items are tracked |
| `pnpm db:reset <env>` | Deletes the database. It refuses a production database unless you pass `--force`. |

The launcher reads these optional overrides: `OPSDASH_PORT` (or `PORT`), `OPSDASH_DB`,
`OPSDASH_CONFIG`, `OPSDASH_ENV_FILE` and `OPSDASH_PLUGINS`. For example:
`OPSDASH_PORT=8080 pnpm start:prod`.

## Running

```text
opsdash --config <dir> --plugins <dir> [--db <file>] [--env-file <file>] [--mock] [--port <n>]
```

| Option | Description |
|--------|-------------|
| `--config` | Either a directory containing `opsdash.yaml`, or a root config file such as `config/production.yaml`. Edits are picked up live, with no restart. |
| `--plugins` | Directory of installed plugins. Each plugin has a `dist/opsdash.manifest.json`. |
| `--db` | The SQLite store (default `./.data/opsdash.db`). It holds tracked item identifiers, links and plugin state only. |
| `--env-file` | An env file with secrets. The process environment takes precedence. |
| `--mock` | Mock mode (also `OPSDASH_MOCK=1`). Every plugin uses its mock source, so no source requests are made and no secrets are needed. Use a separate `--db` for mock mode. |
| `--port` | HTTP port (default 4400). |

- **Health:** `GET /healthz` returns `healthy`, `degraded` (config errors or plugin problems) or
  `unhealthy` (the store is unusable, HTTP 503).
- **Logs:** structured JSON on stdout.
- **Status:** `GET /api/status` lists config errors and the state of each plugin.

### Security

**Opsdash has no built-in authentication.** Anyone who can reach the port can view every dashboard and
track or untrack items. Run it on a trusted network or behind a reverse proxy that handles
authentication.

Secrets are never stored. Config refers to them by environment variable name, for example
`token: { env: MY_TOKEN }`. Their values stay on the server and are redacted from logs and errors.

## Configuration

Start from [`examples/config`](examples/config). The format is YAML. Point your editor at the published
schema, `GET /schema/config.v1.json`, with a `yaml-language-server` modeline to get autocompletion.

```yaml
version: 1
include: [blocks.yaml]            # split config across files
theme: { mode: system, tokens: { color-accent: "#3b5bdb" } }
plugins:
  reference: { version: "^1.0.0", settings: { apiToken: { env: REFERENCE_TOKEN } } }
dashboards:
  - id: overview
    title: Overview
    items:
      - { id: open-items, plugin: reference, title: Open items, at: [1, 1], size: [6, 4] }
      - { id: team-a, use: team-panel, at: [7, 1], size: [6, 4], with: { title: "Team A" } }
```

- **Layout:** a 12-column grid. `at: [column, row]` and `size: [width, height]` are in grid units. On
  narrow screens it collapses to a single column.
- **Blocks:** reusable arrangements of widgets, with `${param}` substitution. A block can be used on any
  dashboard and inside other blocks.
- **Errors:** every error names the file, line, column and document path. An invalid dashboard doesn't
  affect the others.
- **Tracked items:** belong to a widget, identified by `dashboard/[block-use/...]widget`. Renaming or
  removing a widget in a valid config deletes its tracked items.

The full format is in [`specs/001-dashboard-host/contracts/config-format.md`](specs/001-dashboard-host/contracts/config-format.md).

## Delivery dashboard (Jira, GitHub and Jenkins)

The **Delivery** dashboard tracks changes as rows. Each row holds a pull request, its Jenkins build
job, and an optional Jira story, with live status for all three:

- Rows are grouped by repository. Each group header shows the main branch's last successful build.
- You add a row with either a pull request or a job; the other is inferred.
- A story key found in the pull request's title or branch is suggested for you to confirm.
- Merged or closed rows move to a Done section and are removed after 7 days.

Each refresh sends one request to Jira, one to GitHub, and one per Jenkins pipeline. While builds
are running, Jenkins refreshes every 10 s.

Try it in mock mode:

```bash
pnpm start -- --config examples/config --plugins plugins --db .data/mock.db --mock
pnpm seed:delivery          # adds sample rows through the actions API
```

Then open http://localhost:4400/#/delivery.

To use real systems, set the plugin settings in `examples/config/opsdash.yaml` and provide the
tokens as environment variables (read-only tokens are enough):

| Plugin | Settings | Environment |
|--------|----------|-------------|
| `jira` | `deployment: cloud` (with `email`) or `datacenter`; `baseUrl`; `projectKeys` | `JIRA_TOKEN`: an API token (Cloud) or a personal access token (Data Center) |
| `github` | `apiUrl` (GitHub.com: `https://api.github.com/graphql`; Enterprise: `https://<host>/api/graphql`); `webUrl`; `defaultRepo` | `GITHUB_TOKEN` |
| `jenkins` | `baseUrl`, `user`, `pipelines` (`owner/name` → pipeline path) or `pipelineTemplate` (default `{name}`) with `defaultOwner`, `mainBranch` (default `main`), `runningRefreshInterval` (default `10s`) | `JENKINS_TOKEN`: an API token |

Jenkins is expected to build pull requests with one multibranch pipeline per repository, with jobs
named `PR-<number>` and a main-branch job.

## Development

```bash
pnpm dev            # one terminal: Vite HMR on :5173 (proxying the host on :4400), the host restarts
                    # on its own source changes, plugins rebuild and hot-reload without a host restart
pnpm test           # unit, integration and contract tests (all run in mock mode)
pnpm test:e2e       # Playwright + axe (set OPSDASH_CHROMIUM to a system Chromium on Alpine/musl)
pnpm typecheck && pnpm lint && pnpm size && pnpm perf:coldstart
```

Writing a plugin? See [`sdk/README.md`](sdk/README.md). A built-in plugin is a folder under `plugins/`
with `src/` and a `plugin.json`, and `pnpm build` builds it with no further setup.

Coming from the old `packages/` layout? See [`MIGRATION.md`](MIGRATION.md).

## Repository layout

One application (`src/`) next to the plugin SDK and the plugins, all installed from the root
`package.json`:

```text
src/
  server/            Node server: config loading, plugin lifecycle, refresh cycle, SQLite store, HTTP + SSE
  client/            Browser UI (Vite + Preact): dashboards, grid, theming, widget frames
  shared/            Types of the payloads exchanged between server and client
sdk/                 @opsdash/plugin-sdk: plugin API types, mock helpers, Vite preset
plugin-lib/          UI shared by several plugins (delivery cells, imported as #delivery-cells)
plugins/<id>/        One folder per plugin: src/, plugin.json (manifest), optional tests/; dist/ is built
drizzle/             SQLite migrations (applied automatically at startup)
tests/               server/, client/ (unit and integration), contract/, e2e/, fixtures/
scripts/             Launcher (opsdash.mjs), build-plugins.mjs, dev.mjs, budget checks
config/  examples/   Environment configs and example configuration
specs/               Spec Kit feature specs, plans and contracts
```

Where to find things:

- Config validation: `src/server/config/`
- Plugin loading and manifests: `src/server/plugins/`
- The refresh cycle and batching: `src/server/refresh/`
- Storage: `src/server/store/`
- The dashboard grid: `src/client/grid/`

The layers are enforced by `pnpm typecheck` (TypeScript project references). Browser code
(`src/client`) can't import `src/server`, and plugins can only reach the host through
`@opsdash/plugin-sdk`.

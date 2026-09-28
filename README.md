# Opsdash

A lightweight, plugin-based dashboard for tracking items across external source systems. Dashboards
are defined in YAML files, widgets come from plugins, and every plugin can run against a built-in mock
source.

## Quick start

Requires Node.js 24 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm build
pnpm mock            # mock mode: no source systems or credentials, sample rows on first start
```

Then open http://localhost:4400.

## Environments

Each environment has a config template in `config/` that shares the dashboards in `config/dashboards/`:

| Environment | Config | Secrets | Start |
|-------------|--------|---------|-------|
| mock | `config/mock.yaml` | none | `pnpm mock` |
| development | `config/development.yaml` | `config/env/development.env` (copy the `.example`) | `pnpm start:dev` |
| production | `config/production.yaml` | `config/env/production.env`, or the service environment | `pnpm start:prod` |

Every start command:

1. checks that the web UI and plugins are built;
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
pnpm dev            # Vite HMR on :5173 (proxying the host on :4400), host restarts on its own
                    # source changes, plugins rebuild and hot-reload without a host restart
pnpm test           # unit, integration and contract tests (all run in mock mode)
pnpm test:e2e       # Playwright + axe (set OPSDASH_CHROMIUM to a system Chromium on Alpine/musl)
pnpm typecheck && pnpm lint && pnpm size && pnpm perf:coldstart
```

Writing a plugin? See [`packages/plugin-sdk/README.md`](packages/plugin-sdk/README.md).

## Repository layout

```text
packages/host        Node server: config, plugins, refresh scheduler, SQLite store, HTTP + SSE
packages/web         Vite + Preact UI
packages/plugin-sdk  Plugin API types, mock helpers, Vite preset
plugins/reference    Reference plugin (simulated source)
examples/config      Example configuration
specs/               Spec Kit feature specs, plans and contracts
```

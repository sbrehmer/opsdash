# Quickstart: Validate the Core Dashboard Host

This guide runs Opsdash end to end, entirely in **mock mode**, so no source systems or
credentials are needed. Formats and behaviour are defined in:
- [contracts/config-format.md](./contracts/config-format.md)
- [contracts/plugin-api.md](./contracts/plugin-api.md)
- [contracts/http-api.md](./contracts/http-api.md)
- [data-model.md](./data-model.md)

## Prerequisites

- Node.js 24 LTS and pnpm 10 (`corepack enable`)
- Playwright browsers for E2E tests (`pnpm exec playwright install chromium`). On Alpine/musl,
  where the bundled browser can't run, install the system `chromium` package and set
  `OPSDASH_CHROMIUM=/usr/bin/chromium`.

## 1. Install and build

```bash
pnpm install
pnpm build              # host, web, plugin-sdk, plugins/reference
```

Expected: every package builds, and `size-limit` passes (web ≤ 60 KB gzipped JavaScript,
reference client ≤ 10 KB).

## 2. Run the example in mock mode

```bash
pnpm start -- --config examples/config --plugins plugins --db .data/mock.db --mock
```

Open http://localhost:4400 and check:

| Check | Expected result | Covers |
|-------|-----------------|--------|
| Page loads | The "Overview" dashboard renders its widgets in the configured grid, and a **Mock mode** badge is visible | US1, FR-050 |
| `/healthz` | `{"status":"healthy"}` | FR-047 |
| Theme | Setting `theme.mode: light` in `examples/config/opsdash.yaml` changes the page within 3 s, with no restart | US1-3/5, SC-007 |
| Track | Hover a widget, choose **Track item**, and enter `ITEM-1`. It appears with mock data. Entering `ITEM-1` again says it's already tracked. Entering `bad` shows an inline error. | US6-6/7/8 |
| Block reuse | Items tracked in `overview/team-a/items` don't appear in the same block's widget on another dashboard | US6-13 |
| Restart | Stop and start the server. Tracked items are still there. | US6-1, SC-008 |

## 3. Batching (SC-003, SC-004)

1. Open the `batching-demo` dashboard in the example. It has 20 reference widgets that
   share 25 references with overlaps.
2. Open the same dashboard in two more browser tabs.
3. Check the logs for `refresh.cycle` events for plugin `reference`.

Expected: each cycle shows **1 fetch** (`requests: 1`) and `refs: 25`. The count is the same
with 1 tab or 3 tabs.

## 4. Failure isolation (US3, SC-005)

Set these in the example config's `plugins.reference.mock` section, one at a time:

| Setting | Expected result |
|---------|-----------------|
| `errorKeys: ["ITEM-2"]` | Only ITEM-2 shows an error, and the other items render (FR-024) |
| `latencyMs: 20000` | The reference widgets show a timeout state, and the other dashboard content keeps updating |
| Rename `plugins.reference.version` to `^9.0.0` | The widgets show a placeholder naming `reference` and `^9.0.0` |

## 5. Config errors (US2, SC-002)

```bash
pnpm test:config-errors     # loads fixtures/invalid-config/* (≥ 20 cases)
```

Expected: every case reports `file:line:column`, the document path, and a message. Valid
dashboards in the same set still resolve.

## 6. Secrets (US7, SC-009)

Run without `--mock`, with `REFERENCE_TOKEN=s3cr3t-value` in `.env`:

```bash
pnpm start -- --config examples/config --plugins plugins --db .data/real.db --env-file .env
pnpm test:secret-scan       # greps config, db, logs, and captured HTTP/SSE output for the value
```

Expected: zero matches. Removing the variable shows `REFERENCE_TOKEN missing for plugin
reference`, and the health status becomes `degraded`.

## 7. Developer hot reload

```bash
pnpm dev
```

This starts the Vite dev server on :5173, the host server under `node --watch`, and a watch
build of the reference plugin.

| Edit | Expected result |
|------|-----------------|
| `packages/web/src/**` | The browser updates through HMR without a full reload |
| `packages/host/src/**` | The server restarts, and the browser's EventSource reconnects on its own |
| `plugins/reference/src/client/**` | The `plugin-reloaded` event fires, and only the reference widgets re-mount |
| `examples/config/*.yaml` | The dashboard updates within 3 s |

## 8. Full test suite

```bash
pnpm test          # vitest: unit, integration, contract (reference plugin, mock mode)
pnpm test:e2e      # playwright + axe: 360/1280/3840 px, light and dark (SC-010)
```

Expected: everything passes.

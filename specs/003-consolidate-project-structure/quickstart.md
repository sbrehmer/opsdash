# Quickstart Validation: Consolidate Project Structure

These scenarios show that the refactor meets the spec. Command behaviour is defined in
[contracts/commands.md](./contracts/commands.md) and the layout rules in
[contracts/layout.md](./contracts/layout.md).

## 0. Baseline (before any change)

On the current `main`:

```bash
rm -rf node_modules packages/*/node_modules plugins/*/node_modules packages/web/dist plugins/*/dist
time (pnpm install && pnpm build)       # record as BASELINE_BUILD
pnpm size                               # record sizes
pnpm perf:coldstart                     # record cold start
```

## 1. Fresh machine, mise only (US1, SC-001, FR-003)

Use a clean container that has only git, curl and mise. There is no system Node, no corepack,
and no global pnpm or vite.

```bash
docker run --rm -it -p 4400:4400 debian:bookworm bash
apt-get update && apt-get install -y git curl ca-certificates build-essential python3
curl https://mise.run | sh && eval "$(~/.local/bin/mise activate bash)"
git clone <repo> opsdash && cd opsdash
mise trust && mise install          # Node 24.21.0 + pnpm 10.33.0
pnpm install --frozen-lockfile
pnpm build
pnpm mock
```

`build-essential` and `python3` are the documented system prerequisites for compiling the native
SQLite driver when no prebuilt binary is available.

**Expected**:
- After `mise install`, none of the commands asks for another tool, and none prints `command not
  found`.
- `http://localhost:4400` shows the mock dashboards with the seeded Delivery rows.
- Elapsed time is under 10 minutes, and there are 4 project commands.

Repeat on `alpine` (musl) up to `pnpm build`. The build must succeed.

## 2. Wrong runtime or wrong tool (US1 scenario 4, FR-004)

```bash
# Node 22 with pnpm, but without mise
docker run --rm -it node:22-bookworm bash -c "npm i -g pnpm@10.33.0 && git clone <repo> o && cd o && pnpm install"
# npm instead of pnpm
docker run --rm -it node:24.21-bookworm bash -c "git clone <repo> o && cd o && npm install"
```

**Expected**:
- The first stops with an unsupported-engine error naming the required range (`>=24.21`).
- The second is refused at once with a message saying the project uses pnpm, and no
  `package-lock.json` is created.

## 3. One dependency declaration (US2, SC-002, SC-003)

```bash
pnpm test -- --project contract layout
```

**Expected**: this passes. The checks are listed in contracts/layout.md "Structural checks".

Try a change by hand: bump `zod` in the root `package.json` and run `pnpm install`. Then
`pnpm why zod` shows a single version, used by server, SDK and plugins.

## 4. Full check suite from the root (US2 scenario 3, SC-004)

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm size && pnpm perf:coldstart
```

**Expected**:
- Everything passes.
- Size and cold-start figures are within the budgets and roughly equal to the baseline.
- The number of tests matches the baseline, apart from new tests.

## 5. Boundary enforcement (US3 scenario 3, FR-016, FR-017)

```bash
echo 'import "../server/log.ts";' >> src/client/main.tsx && pnpm typecheck; git checkout src/client/main.tsx
echo 'import "../../../src/server/log.ts";' >> plugins/reference/src/client.tsx && pnpm typecheck; git checkout plugins/reference/src/client.tsx
```

**Expected**: both type checks fail, and the error names the importing file and
`src/server/log.ts`.

## 6. Add a built-in plugin with no build files (US3 scenario 5, SC-005)

```bash
cp -r plugins/reference plugins/sample && rm -rf plugins/sample/dist
sed -i 's/"id": "reference"/"id": "sample"/; s/plugin-reference/plugin-sample/' plugins/sample/plugin.json
pnpm build && pnpm config:check mock
```

**Expected**:
- `plugins/sample/dist/opsdash.manifest.json` exists.
- `/api/status` lists `sample: loaded` when the server starts.
- No `package.json`, `vite.config.ts` or `tsconfig.json` was added.

Clean up with `rm -rf plugins/sample`.

## 7. Third-party plugin shape still builds and loads (US4, SC-007, FR-010)

```bash
pnpm test -- --project contract copy-plugin
```

**Expected**: this passes. The test builds a copy of the reference plugin that has its own
`package.json` (with an `opsdash` field) and a `vite.config.ts`, and checks that it loads next
to the original.

## 8. Dev mode (FR-013)

Run `pnpm dev`, then edit these files one at a time:
- a string in `src/client/app.tsx`
- a log message in `src/server/http/health.ts`
- a label in `plugins/reference/src/client.tsx`

**Expected**:
- The client change hot-reloads on :5173.
- The server restarts on its own.
- The plugin rebuilds, and its widget shows the new label after a reload.
- Ctrl-C stops all three processes.

## 9. Build time and stale checkout (SC-006, edge cases)

- Run `time pnpm build` from clean. The result must be ≤ 1.1 × BASELINE_BUILD.
- In a checkout that still has `packages/` or `plugins/*/node_modules`, `pnpm build` prints the
  stale-layout hint from contracts/commands.md.

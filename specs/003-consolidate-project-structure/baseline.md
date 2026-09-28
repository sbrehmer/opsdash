# Baseline (before the refactor)

Recorded 2026-09-28 on `main` at `1743205`, in the Alpine dev container (Node 24.21.0, pnpm 10.34.5).

| Measure | Value |
|---------|-------|
| Clean install + build (`pnpm install --frozen-lockfile && pnpm build`, warm pnpm store) | 2.87 s |
| Build only (`pnpm build`) | 2.08 s |
| web initial JS / CSS (gzip) | 14.76 kB / 2.07 kB |
| Plugin clients (gzip) | reference 595 B, jira 1.59 kB, github 1.82 kB, jenkins 2.28 kB, delivery 5.46 kB |
| Cold start to healthy / idle RSS | 491 ms / 129.0 MB |
| `pnpm test` | 25 files, 183 tests passed |
| `pnpm test:e2e` (`OPSDASH_CHROMIUM=/usr/bin/chromium`) | 43 passed, 20 skipped |
| `pnpm typecheck` / `pnpm lint` | pass / pass (2 warnings) |

Playwright's bundled browser doesn't run on this musl container. E2E needs `OPSDASH_CHROMIUM`, as documented.

## After the refactor

### US1 fresh-install check (T028)

There's no Docker or Podman in this dev container, so quickstart §1–§2 were **not run in clean
Debian or Alpine containers**. Instead:

- **Fresh copy on this Alpine (musl) machine.** Every tracked and new file except `specs/` was
  copied to a scratch directory with no `node_modules` or `dist`. `pnpm install --frozen-lockfile
  && pnpm build` took 14 s (download from the warm store included). `pnpm mock` then started;
  `/healthz` returned `healthy` and every plugin showed `loaded`.
- **§2 wrong Node / npm.** Verified by manifest simulation; see research.md R2, "Verified".

Still to do: run §1 in a clean container with only mise on a machine that has Docker.

### Final gate (T043, T044)

| Measure | Before | After |
|---------|--------|-------|
| Clean install + build (warm store) | 2.87 s | 2.88 s / 2.91 s (≈1.0×, SC-006 ≤ 1.1×) |
| Build only (`pnpm build`) | 2.08 s | 1.23 s |
| web initial JS / CSS (gzip) | 14.76 kB / 2.07 kB | 14.76 kB / 2.07 kB |
| Plugin clients (gzip) | 595 B, 1.59, 1.82, 2.28, 5.46 kB | 579 B, 1.57, 1.80, 2.26, 5.46 kB |
| Cold start / idle RSS | 491 ms / 129.0 MB | 433 ms / 130.9 MB |
| `pnpm test` | 25 files, 183 tests | 28 files, 199 tests (183 existing + 16 new: toolchain 3, layout 9, sdk manifest-source 4) |
| `pnpm test:e2e` | 43 passed, 20 skipped | 43 passed, 20 skipped |
| `pnpm typecheck` / `pnpm lint` | pass / pass (2 warnings) | pass (`tsc -b`) / pass (the same 2 warnings) |

**Dev mode (§8).** `pnpm dev` started the server, Vite and the plugin watchers:
- Vite on :5173 returned 200, and it proxied `/api/status`.
- Editing `plugins/reference/src/client.tsx` rebuilt the plugin, and the host logged
  `plugin.loaded` and `config.reloaded` without restarting.
- Editing `src/server/http/health.ts` restarted the server.
- SIGINT stopped all three processes; 0 were left running.

Client HMR in a browser was not observed by hand.

**Stale layout (§9).** With a `packages/` directory present, `build-plugins.mjs` printed the
old-layout hint.

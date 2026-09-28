# Contract: Directory Layout & Import Boundaries

The layout is listed in [plan.md](../plan.md#source-code-repository-root-after-this-feature)
and the path map is in [data-model.md](../data-model.md#path-map). This contract states the
rules that tests or the type check enforce.

## Import boundaries (FR-016, FR-017)

| From \ To | `src/server` | `src/client` | `src/shared` | `sdk` (`@opsdash/plugin-sdk*`) | `plugin-lib` (`#delivery-cells`) | npm packages |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|
| `src/server` | ✅ | ❌ | ✅ | ✅ | ❌ | ✅ |
| `src/client` | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `src/shared` | ❌ | ❌ | ✅ | type-only | ❌ | type-only |
| `sdk` | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ (peers) |
| `plugins/*`, `plugin-lib` | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `tests/**` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

❌ fails `pnpm typecheck` with TS6307, which names the importing file and the imported file
outside the project (research R4). If the documented fallback is used, it fails `pnpm lint`
with a `noRestrictedImports` message instead.

## Structural checks (`tests/contract/layout.test.ts`)

1. Exactly one `package.json` in the repo, outside `node_modules` and test temp directories, has
   `dependencies` or `devDependencies`: the root one (SC-002, FR-001).
2. No package name appears in both `dependencies` and `devDependencies` of the root (SC-003).
3. `sdk/package.json` has only the allowed fields, and each `peerDependencies` range is
   satisfied by the version installed in `node_modules` (FR-002).
4. No `plugins/<id>/` contains `package.json`, `vite.config.*`, `tsconfig.json` or
   `node_modules/` (SC-005, FR-008). Each one contains `plugin.json`.
5. `packages/` doesn't exist, and `pnpm-workspace.yaml` has no `packages` key.
6. The `pnpm` version in `mise.toml` equals the version in `package.json` `packageManager`, and
   the `node` pin in `mise.toml` satisfies `engines.node` (FR-004).

# Contract: Plugin Manifest Source & SDK Build Preset

Plugin API version: **unchanged (1.1.x)**. This contract covers only where the build reads a
plugin's metadata from. The built `dist/opsdash.manifest.json` the host reads stays the same
(see `specs/002-delivery-tracker/contracts/plugins.md`).

## Built-in plugins: `plugins/<id>/plugin.json`

```json
{
  "name": "@opsdash/plugin-github",
  "version": "1.0.0",
  "id": "github",
  "apiVersion": "^1.1.0",
  "server": "server.js",
  "client": "client.js",
  "capabilities": ["track"],
  "env": ["GITHUB_TOKEN"],
  "refresh": { "interval": "60s", "timeout": "10s" },
  "maxBatchSize": 50
}
```

- `name` and `version` are required. They were previously `package.json` `name`/`version`.
- Every other field is today's `package.json` `opsdash` object, moved to the top level
  unchanged. That covers `id`, `apiVersion`, `server`, `client`, `capabilities` and `env`,
  `refresh`, and the optional `maxBatchSize` and `composes`.
- The file has no `dependencies`, `scripts` or `type`. Dependencies come from the root
  (FR-008).

## Third-party plugins: `package.json` (unchanged, FR-010)

```json
{ "name": "@acme/opsdash-foo", "version": "1.0.0", "type": "module",
  "opsdash": { "id": "foo", "apiVersion": "^1.1.0", "…": "…" },
  "devDependencies": { "@opsdash/plugin-sdk": "^1.1.0", "vite": "^8.3.1" } }
```

They build with their own `vite.config.ts` using `opsdashPlugin()`, as today.

## `opsdashPlugin()` resolution order

1. If `<root>/plugin.json` exists, use `{ name, version, ...rest }` from it.
2. Otherwise, if `<root>/package.json` has an `opsdash` field, use `name` and `version` from the
   package and the rest from `opsdash`.
3. Otherwise, fail the build with:
   `No plugin manifest: add plugin.json or an "opsdash" field in package.json (<root>)`.

The generated manifest is `{ ...fields, name, version, settingsSchema, referenceSchema, hasMock, style? }`.
Both sources produce identical output for identical input. The rewritten
`copy-plugin.test.ts` and a unit test in the `sdk` project check this.

## `scripts/build-plugins.mjs`

- Plugin directories are `plugins/*` that contain a `plugin.json` or a `package.json`.
- A plugin that has its own `vite.config.*` is built with that file. Otherwise the script uses
  `{ root, configFile: false, plugins: [opsdashPlugin()] }`.
- Plugins build concurrently. The exit code is non-zero if any plugin fails, and each failure is
  prefixed with the plugin id.
- `--watch` rebuilds a plugin when its `src/`, `plugin.json`, `plugin-lib/` or `sdk/src/`
  changes.

# Contract: Plugin API v1.0.0

> Plugin API **1.1.0** adds composite plugins, widget actions, resolvers, per-reference `batchKey`,
> `ctx.scheduleNext` and `sourceRequest`. The additions are backward compatible; see
> [002 plugin-api-1.1.md](../../002-delivery-tracker/contracts/plugin-api-1.1.md).

This is the public plugin contract. It has its own semantic version, separate from the
application version (FR-017). Built-in plugins, including the reference plugin, use only
this API (FR-020). The types are published from `@opsdash/plugin-sdk`.

## 1. Package layout and manifest

A plugin is a directory (usually an npm package) inside the plugin directory. The author
writes the manifest fields in the `opsdash` block of `package.json`. At build time the SDK
Vite preset (`opsdashPlugin()`) imports the built server module and writes the **complete
manifest** to `dist/opsdash.manifest.json`. That file holds the `package.json` block plus
`name`, `version`, and the plugin's configuration schema (`settingsSchema`) and reference
schema (`referenceSchema`), both generated as JSON Schema with `z.toJSONSchema()`.

The host reads only `dist/opsdash.manifest.json` before running any plugin code, so it can
refuse an incompatible plugin without executing it. This file is the manifest the
constitution and FR-015 refer to.

Source (`package.json`):

```jsonc
{
  "name": "@acme/opsdash-reference",
  "version": "1.0.0",
  "type": "module",
  "opsdash": {
    "id": "reference",                 // stable identifier, slug
    "apiVersion": "^1.0.0",            // plugin-API range the plugin targets
    "server": "server.js",             // relative to dist/; ESM, runs in Node
    "client": "client.js",             // relative to dist/; ESM, runs in browser; externals per §4
    "capabilities": ["track"],         // "track" = supports track/untrack; mutating capabilities refused in v1
    "env": ["REFERENCE_TOKEN"],        // env vars it may read (FR-015, FR-036)
    "refresh": { "interval": "60s", "timeout": "10s" },
    "maxBatchSize": 100                // optional
  }
}
```

Generated (`dist/opsdash.manifest.json`, never hand-written):

```jsonc
{
  "id": "reference", "name": "@acme/opsdash-reference", "version": "1.0.0",
  "apiVersion": "^1.0.0", "server": "server.js", "client": "client.js",
  "capabilities": ["track"], "env": ["REFERENCE_TOKEN"],
  "refresh": { "interval": "60s", "timeout": "10s" }, "maxBatchSize": 100,
  "settingsSchema": { "type": "object", "properties": { "view": { "enum": ["list", "compact"] } } },
  "referenceSchema": { "type": "object", "properties": { "key": { "type": "string" } } },
  "hasMock": true
}
```

The host refuses the plugin (FR-016, FR-049) when:
- `dist/opsdash.manifest.json` is missing, or a required field is missing (including
  `settingsSchema` and `referenceSchema`);
- `apiVersion` doesn't match the host's API version;
- the `id` is a duplicate;
- a capability is not in `["track"]`;
- `hasMock` is not `true`, or the server module doesn't export `mock` once it is loaded.

## 2. Server module

```ts
import { definePlugin, z, secret, createMockSource } from "@opsdash/plugin-sdk";

export default definePlugin({
  settings: z.object({ view: z.enum(["list", "compact"]).default("list"),
                       apiToken: secret() }),          // secret() accepts only { env: NAME }
  reference: z.object({ key: z.string().regex(/^[A-Z]+-\d+$/) }),
  refKey: (ref) => ref.key,                              // canonical, unique per plugin

  // Optional: groups widgets whose settings point at different source instances.
  batchKey: (settings) => "default",

  // Optional: data needs of a widget. Defaults to the widget's tracked refs.
  needs: (widget) => widget.trackedRefs,

  // Turns user input from "track item" into a reference, or rejects it (FR-032).
  async parseReference(input, ctx) { /* return { ok: ref } | { error: "..." } */ },

  // ONE call resolves a whole batch (≤ maxBatchSize). MUST NOT loop per ref when the
  // source supports batching (constitution: Plugin Data Pattern).
  async fetch(refs, ctx) {
    // return Map<refKey, { data: unknown } | { error: string }> — partial results allowed
  },

  // REQUIRED (FR-049): same signatures, no network, no secrets.
  mock: createMockSource({
    generate: (ref, rng) => ({ title: `Item ${ref.key}`, status: rng.pick(["open","done"]) }),
    parseReference: (input) => /^[A-Z]+-\d+$/.test(input) ? { ok: { key: input } }
                                                           : { error: "Expected KEY-123" },
  }),
});
```

### Context (`ctx`) passed to `parseReference` and `fetch`

| Member | Description |
|--------|-------------|
| `ctx.settings` | The merged, validated settings for this batch group. Secrets are still `{env}` objects. |
| `ctx.secrets.get(name)` | Resolves an environment variable declared in the manifest, server-side only. Throws for undeclared names. In mock mode it is never called. |
| `ctx.signal` | An `AbortSignal` that fires on timeout. Plugins must pass it to their network calls. |
| `ctx.log` | A pino child logger, with redaction applied |
| `ctx.state` | `get/set/delete/list` for this plugin's namespace only (FR-021) |
| `ctx.refs.find(pluginId, refKey)` | Read-only lookup of stored refs from any plugin. Returns identifiers only. |
| `ctx.links` | `create(fromRefId, toRefId)`, `remove(...)`, and `list(refId)` (both directions) |
| `ctx.mock` | `true` in mock mode |
| `ctx.mockFaults` | Fault settings from config `plugins.<id>.mock` (used by `createMockSource`) |

### Guarantees the host gives plugins

- `fetch` is never called at the same time twice for the same `batchKey` (FR-026).
- `refs` contains no duplicates and never holds more than `maxBatchSize` entries.
- Errors thrown by the plugin and timeouts are caught. They affect only the widgets that
  need those refs (FR-018, FR-024).

## 3. Mock source (`createMockSource`)

`createMockSource(options)` takes:

| Option | Description |
|--------|-------------|
| `generate(ref, rng)` | Returns realistic data for any valid ref. `rng` is seeded by `refKey`, so results are deterministic. |
| `parseReference(input)` | Validates the format offline |
| `refKey(ref)` | Same canonical key as the plugin's `refKey` |
| `fromKey(key)` | Optional: builds a ref from a key (used for `extraKeys`) |
| `faults` (default) | `{ notFound: string[], errorKeys: string[], omitKeys: string[], extraKeys: string[], latencyMs: number, errorRate: 0..1 }`. `omitKeys` leaves those keys out of the result map, and `extraKeys` adds keys that weren't requested. |

Faults can be overridden per plugin in config through `plugins.<id>.mock` (active only in
mock mode). The mock counts calls in `ctx.state` under `__mock.requests`, so tests can assert
batching (SC-003).

## 4. Client module (widget)

```ts
import { defineWidget } from "@opsdash/plugin-sdk/client";

export default defineWidget({
  // Optional custom states; host defaults are used otherwise (FR-041).
  render({ items, settings, title, state }) { /* Preact JSX */ },
});
```

| Prop | Type |
|------|------|
| `items` | `Array<{ refKey, ref, data?, error? }>` |
| `state` | `"loading" \| "ok" \| "empty" \| "error" \| "stale" \| "timeout"` |
| `lastSuccessAt` | `number?` |
| `settings` | Settings with secrets removed |
| `title` | `string?` |

The host provides these around every widget:
- the widget frame;
- the track and untrack controls, shown on hover or focus when the manifest declares
  `track`;
- an error boundary (FR-018).

Rules for the client bundle:
- `preact`, `preact/hooks`, `preact/jsx-runtime`, and `@preact/signals` are externals,
  resolved through the host's import map. `@opsdash/plugin-sdk/client` is stateless and is
  bundled into the plugin.
- A widget can render states itself by listing them in `handlesStates`. Otherwise the host's
  defaults are used. Use the preset:
  `import { opsdashPlugin } from "@opsdash/plugin-sdk/vite"`.
- Styles must use `var(--od-*)` design tokens and be scoped to the widget (CSS Modules
  through the preset). Global selectors are forbidden (FR-037).

## 5. Versioning

- Host API version 1.0.0. The host accepts plugins whose `apiVersion` range includes 1.0.0.
- A breaking change to anything in this document bumps the MAJOR version and needs a
  migration guide (constitution: Storage & Plugin Contract).

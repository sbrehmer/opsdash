# @opsdash/plugin-sdk

Everything needed to build an Opsdash plugin. A plugin provides one widget type and connects it to one
kind of source system. The reference plugin in [`plugins/reference`](../../plugins/reference) is the
worked example for every section below. Copy it to start a new plugin.

Plugin API version: **1.1.0**. It is versioned separately from Opsdash itself. Version 1.1 only adds to 1.0, so plugins that target `^1.0.0` keep working.

## Layout

```text
my-plugin/
├── package.json        # name, version, and the "opsdash" manifest block
├── vite.config.ts      # export default defineConfig({ plugins: [opsdashPlugin()] })
└── src/
    ├── server.ts       # definePlugin(...): runs in the Opsdash server (Node)
    ├── client.tsx      # defineWidget(...): runs in the browser (Preact)
    └── *.module.css    # widget styles (CSS Modules, design tokens only)
```

`vite build` produces `dist/client.js`, `dist/style.css`, `dist/server.js` (all dependencies bundled)
and `dist/opsdash.manifest.json`. To install the plugin, copy the directory, or just its `dist/`, into
the Opsdash plugin directory. The host never runs your build.

## Manifest

Write the manifest fields in `package.json`. File paths are relative to `dist/`:

```json
"opsdash": {
  "id": "my-plugin",
  "apiVersion": "^1.0.0",
  "server": "server.js",
  "client": "client.js",
  "capabilities": ["track"],
  "env": ["MY_PLUGIN_TOKEN"],
  "refresh": { "interval": "60s", "timeout": "10s" },
  "maxBatchSize": 100
}
```

| Field | Meaning |
|-------|---------|
| `id` | A stable identifier: lowercase letters, digits and dashes. Config refers to the plugin by this id. |
| `apiVersion` | The range of plugin API versions you target. An incompatible host refuses the plugin with a message. |
| `capabilities` | `"track"` lets operators track and untrack items in your widget. Mutating capabilities are refused in API v1. |
| `env` | Every environment variable the plugin may read. Anything else is refused at runtime. |
| `refresh` | The default refresh interval and fetch timeout. Operators can override both in config. |
| `maxBatchSize` | The largest batch your source accepts. The host splits larger batches into the fewest chunks. |

The build adds `name`, `version`, `settingsSchema`, `referenceSchema` (JSON Schema generated from your
Zod schemas) and `hasMock`. The host reads only this generated file before running any of your code.

## Server module

```ts
import { createMockSource, definePlugin, secret, z } from "@opsdash/plugin-sdk";

export default definePlugin({
  settings: z.strictObject({ project: z.string(), token: secret() }),
  reference: z.strictObject({ key: z.string() }),
  refKey: (ref) => ref.key,
  parseReference: (input) => ({ ok: { key: input.trim() } }),
  async fetch(refs, ctx) {
    const token = ctx.secrets.get(ctx.settings.token.env);
    // ONE request for the whole batch; see "Plugin data pattern" below.
    return new Map(/* refKey -> { data } | { error } */);
  },
  mock: createMockSource({ /* see "Mock source" */ }),
});
```

| Member | Purpose |
|--------|---------|
| `settings` | A Zod schema for widget settings. It is checked against config on load, and errors point to the YAML line. |
| `reference` | A Zod schema for the identifiers stored for a tracked item. Store identifiers only. |
| `refKey(ref)` | The canonical string key of a reference. It must be unique within your plugin. |
| `batchKey(settings)` | Optional. Widgets whose settings point at different source instances (for example different base URLs) get different keys, and each key gets its own batch. |
| `needs({ settings, trackedRefs })` | Optional. The references a widget shows. The default is the widget's tracked references. |
| `parseReference(input, ctx)` | Turns "track item" input into a reference, or returns `{ error }` with a message for the operator. |
| `fetch(refs, ctx)` | Resolves a whole batch. Return a `Map` of `refKey` to `{ data }` or `{ error }`; partial results are fine. |
| `mock` | **Required.** It has the same signatures as the real source. |

### Context (`ctx`)

| Member | Description |
|--------|-------------|
| `settings` | The validated settings for this batch. Secrets are still `{ env }` references. |
| `secrets.get(name)` | Reads an environment variable declared in the manifest, server-side only. The value is redacted from all logs and errors. |
| `signal` | Aborts when the fetch timeout is reached. Pass it to every network call. |
| `log` | A structured logger tagged with your plugin id. |
| `state` | `get`, `set`, `delete` and `list` on your plugin's private namespace. |
| `refs.find(pluginId, refKey)` | Read-only lookup of stored references from any plugin (identifiers only). |
| `links` | `create`, `remove` and `list` for links between stored references, including across plugins. |
| `mock`, `mockFaults` | Whether the host runs in mock mode, and the fault settings from config. |

## Plugin data pattern (constitution)

Every plugin must follow these rules:

1. **Persist references only.** The host stores the identifiers a widget tracks and the links between
   them. Never store item content or status.
2. **Link through the host.** Use `ctx.links`. Never depend on another plugin's internals.
3. **Query live.** Item details are fetched from the source each time they are shown. The host adds a
   short-lived cache.
4. **Batch every fetch.** Resolve the whole list in as few requests as the source allows: a query
   language that fetches many items at once, an endpoint that accepts many ids, or a search or filter
   query. A request per item in a loop (N+1) is allowed only when the source has no batch mechanism,
   and the feature plan must record why.
5. **Let the host coordinate.** The host gathers what every visible widget needs, removes duplicates,
   caches results, and calls `fetch` once per `batchKey`, or once per chunk of `maxBatchSize`. It never
   runs two fetches for the same plugin at the same time.

## Mock source

Every plugin must ship a mock source; plugins without one are refused. Opsdash runs entirely on mocks
with `--mock` (or `OPSDASH_MOCK=1`): no source requests are made and no secrets are needed.

```ts
mock: createMockSource({
  refKey: (ref) => ref.key,
  fromKey: (key) => ({ key }),
  parseReference: (input) => (/^[A-Z]+-\d+$/.test(input) ? { ok: { key: input } } : { error: "Expected KEY-123" }),
  generate: (ref, rng) => ({ title: rng.pick(["Fix", "Add"]) + " " + ref.key, status: rng.pick(["open", "done"]) }),
}),
```

`generate` receives a random number generator seeded by the ref key, so mock data is deterministic.
Operators and tests can inject faults per plugin in config:

```yaml
plugins:
  my-plugin:
    mock: { notFound: ["X-404"], errorKeys: ["X-2"], omitKeys: [], extraKeys: [], latencyMs: 200, errorRate: 0 }
```

The mock counts its calls in `ctx.state` under `__mock.requests`, which lets tests check batching.

## Widget (client module)

```tsx
import { defineWidget } from "@opsdash/plugin-sdk/client";
import css from "./widget.module.css";

export default defineWidget({
  render: ({ items, settings, state }) => (
    <ul class={css.list}>{items.map((i) => <li key={i.refKey}>{i.data ? String(i.data.title) : i.error}</li>)}</ul>
  ),
});
```

- The props are `items` (`{ refKey, ref, data?, error? }`), `state`, `lastSuccessAt`, `error`, `settings`
  (with secrets removed) and `title`.
- The host renders the frame, the title, the track and untrack controls, an error boundary, and the
  default `loading`, `empty`, `error`, `timeout` and `stale` presentations. List the states you render
  yourself in `handlesStates`.
- Style only with the host's design tokens: `var(--od-color-text)`, `--od-color-accent`,
  `--od-space-unit`, `--od-radius` and so on. Scope styles with CSS Modules and never use global
  selectors. Light and dark themes then work automatically.
- `preact`, `preact/hooks`, `preact/jsx-runtime` and `@preact/signals` come from the host page through
  its import map. The preset keeps them external, so every widget shares the host's Preact.

## Plugin API 1.1 additions

### Batching per reference

`batchKey(settings, ref)` receives each reference, so a plugin can group requests by something that
belongs to the reference itself. The Jenkins plugin, for example, returns `ref.pipeline` to get one
request per pipeline.

### Faster refresh and back-off

`ctx.scheduleNext(ms)` asks for the plugin's next refresh after `ms`, once. The host uses
`min(ms, interval)`, and refreshes never overlap. The Jenkins plugin uses it to refresh every 10 s
while builds are running.

For rate limits, throw an error that has `retryAfterMs`; `SourceError` from `sourceRequest` does
this for 429 and rate-limited 403 responses. The host then backs off that plugin automatically.

### `sourceRequest`

```ts
import { sourceRequest } from "@opsdash/plugin-sdk";
const body = await sourceRequest<Resp>(url, { tool: "GitHub", method: "POST", json: { query }, headers: { authorization } }, ctx);
```

`sourceRequest` wraps built-in `fetch`. It passes `ctx.signal`, sends and parses JSON, and turns
non-2xx responses into `SourceError { status, retryAfterMs }`. Its messages never include headers
or response bodies.

### Resolvers

A source, and its mock, can export `resolvers: { name(input, ctx) }`. Other plugins call them
through the host with `ctx.plugins.resolve(pluginId, name, input)`, and can parse input with another
plugin's parser through `ctx.plugins.parse(pluginId, input)`. The target runs with its own
plugin-level settings, secrets and state. Callers depend only on the resolver's documented name and
data shape, never on the target plugin's internals.

### Widget actions (capability `"actions"`)

`actions: { name(payload, ctx) }` are named operations that a widget calls with
`props.actions.run(name, payload)` (`POST /api/widgets/:path/actions/:name`). Through `ctx.widget`,
they may change only Opsdash's own store for the calling widget:

- `refs()` and `links()`;
- `track(pluginId, ref)`, `untrack(id, { cascade })`;
- `link(a, b)` and `unlink(a, b)`;
- `transaction(fn)`.

Actions never write to source systems. Return `{ ok: true }` or `{ error: "sentence for the operator" }`.

### Composite plugins (`composes`)

A composite plugin has no source of its own. Its manifest lists `composes: ["github", "jenkins",
"jira"]`, and its widget shows items owned by those plugins. The host fetches each item in its owning
plugin's normal batch, so a composite widget adds no requests. After each refresh, the host calls
`onData(data, ctx)`, which may prune rows and return `meta` for the client. The widget receives
`items[]` (with `plugin`, `id` and per-item `state`), `links` and `meta`.

Composite plugins need no reference, fetch or mock, but they must declare a settings schema. The
`delivery` plugin in `plugins/delivery` is the worked example.

## Development

`pnpm dev` at the repository root runs the host, the web UI with hot module reload, and every plugin's
`vite build --watch`. When your plugin rebuilds, the host swaps it in without restarting and only your
widgets re-mount.

## Versioning

Breaking changes to anything in this guide bump the plugin API's MAJOR version and come with a
migration guide.

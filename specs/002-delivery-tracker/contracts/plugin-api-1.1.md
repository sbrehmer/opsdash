# Contract: Plugin API 1.1.0 (additions to 1.0.0)

Every change here is **additive**. Plugins that target `^1.0.0` keep working unchanged (FR-029),
and the reference plugin and its tests must pass as they are. The base contract is
[001 plugin-api.md](../../001-dashboard-host/contracts/plugin-api.md).

## Manifest additions

| Field | Meaning |
|-------|---------|
| `capabilities: ["actions"]` | The plugin defines widget actions. Actions may change only Opsdash's own store for the calling widget; they are not mutating actions on source systems. |
| `composes: string[]` | Makes the plugin a **composite plugin**, whose widget shows references owned by the listed plugins. A composite plugin has no source, so `reference`, `refKey`, `parseReference`, `fetch` and `mock` are optional, and `hasMock` and `referenceSchema` are not required. Its `settingsSchema` IS still required (constitution: every manifest declares its configuration schema). |

A composite plugin whose composed plugin isn't loaded still loads. Its references from the missing
plugin show a per-item error: "plugin <id> is not installed".

## Server additions

```ts
definePlugin({
  // Grouping per reference (was: per widget settings). The second argument is new; existing
  // plugins ignore it.
  batchKey?(settings, ref): string,

  // Source-level helpers another plugin can call through the host (on the real source and on
  // the mock).
  resolvers?: { [name: string]: (input: unknown, ctx: PluginContext) => Promise<unknown> },
  mock: { fetch, parseReference, resolvers? },

  // Widget actions (capability "actions").
  actions?: { [name: string]: (payload: unknown, ctx: ActionContext) => Promise<ActionResult> },

  // Composite plugins only: called after the host assembles the widget's data. May prune
  // references and may return meta for the client.
  onData?(data: CompositeWidgetData, ctx: ActionContext): Promise<{ meta?: unknown } | void>,
});

type ActionResult = { ok: true; message?: string } | { error: string };
```

### `PluginContext` additions (available everywhere)

| Member | Description |
|--------|-------------|
| `ctx.scheduleNext(ms)` | Asks for this plugin's next refresh after `ms`, once. The host uses `min(ms, interval)` unless a rate-limit back-off (the larger value) is active. Runs never overlap. |
| `ctx.plugins.parse(pluginId, input)` | Runs the target plugin's `parseReference` (the mock version in mock mode) and returns `{ ok: ref }` or `{ error }`. |
| `ctx.plugins.resolve(pluginId, name, input)` | Runs the target plugin's resolver, with the target's own plugin-level settings, secrets and state, and a fresh timeout. It throws `ResolverError` when the plugin or resolver doesn't exist. |
| `ctx.mockFaults.scenario` | A free-form object from config `plugins.<id>.mock.scenario`, for plugin-specific mock scenarios. |

### `ActionContext` (actions and `onData`)

`ActionContext` is a `PluginContext` plus:

| Member | Description |
|--------|-------------|
| `ctx.widget.path`, `ctx.widget.settings` | The calling widget |
| `ctx.widget.refs()` | `StoredRef[]` for every reference tracked in this widget, from any plugin |
| `ctx.widget.links()` | `{ from, to }[]` between this widget's references |
| `ctx.widget.track(pluginId, ref)` | Validates `ref` with the owning plugin's reference schema, stores it and returns the `StoredRef`. Returns the existing reference if it is already tracked. |
| `ctx.widget.untrack(refId, { cascade? })` | Removes one reference. With `cascade`, it also removes linked references in this widget that end up with no links. |
| `ctx.widget.link(fromId, toId)`, `ctx.widget.unlink(fromId, toId)` | Manage links between this widget's references |
| `ctx.widget.transaction(fn)` | Runs a synchronous function in one store transaction |

After a successful action, the host re-runs the widget's data needs straight away.

## Host behaviour for composite widgets

- `runPaths` for a composite widget runs each owning plugin, for that widget's references only.
- The composite widget's data is assembled and published on subscribe, when the widget has no
  references (`state: "empty"`), and right after every action, as well as after each contributing
  plugin's run.
- Rate-limit back-off is generic: a `SourceError` with `retryAfterMs` from any plugin delays that
  plugin's next tick to at least `retryAfterMs`.

## SDK additions

- `sourceRequest(url, init, ctx)`: a `fetch` wrapper that passes `ctx.signal`, turns non-2xx
  responses into `SourceError { status, retryAfterMs, message }` (never including headers), and
  parses JSON.
- `ResolverError` and `SourceError` classes.

## Client SDK additions

`WidgetProps` gains:

| Prop | Type |
|------|------|
| `items[].plugin` | Owning plugin id. Always set, including for simple plugins. |
| `items[].id` | Stored reference id, for composite widgets |
| `links` | `{ from, to }[]`, for composite widgets |
| `meta` | `unknown`, from `onData` |
| `actions.run(name, payload)` | `Promise<ActionResult>`, which POSTs to the actions route |
| `itemState(item)` | Per-item freshness: `"ok"`, `"stale"` or `"error"`, with `lastSuccessAt` |

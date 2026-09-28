# Data Model: Core Dashboard Host

Phase 1 output for [plan.md](./plan.md). There are two kinds of model:

- **Configuration model**: held in memory, loaded from YAML, never persisted to the store.
- **Store model**: SQLite through Drizzle, holding only references, links, and plugin state.

The YAML format itself is defined in [contracts/config-format.md](./contracts/config-format.md).

## A. Configuration model (in memory)

### ConfigSet

The result of loading every file reachable through `include` from the root config file.

| Field | Type | Rules |
|-------|------|-------|
| version | `1` | Required in the root file. Unknown versions are an error. |
| files | `string[]` | Every file that was loaded. Include cycles are an error (FR-010). |
| defaults | `{ refreshInterval, cacheWindow, timeout }` | Durations such as `60s` or `5m`. Defaults are 60s, 30s, and 10s. |
| theme | `ThemeSpec` | Global default. |
| plugins | `Record<PluginId, PluginConfig>` | Keyed by plugin identifier. |
| dashboards | `Dashboard[]` | Identifiers must be unique across the set. |
| blocks | `Record<BlockName, Block>` | Names must be unique across the set. |
| errors | `ConfigError[]` | Every validation error found. |
| valid | `boolean` | False if any file failed to parse. Used by the deletion rule below. |

### ConfigError

| Field | Type | Notes |
|-------|------|-------|
| file | string | Path relative to the config root |
| line, column | number | 1-based |
| path | string | Document path, for example `dashboards[0].widgets[2].size` |
| message | string | Plain language |
| scope | `{dashboard?: string, block?: string, plugin?: string}` | Where the error applies. Used to isolate the error (FR-009). |

### ThemeSpec

| Field | Type | Rules |
|-------|------|-------|
| mode | `"light" \| "dark" \| "system"` | Default `system` |
| tokens | `Record<TokenName, string>` | Keys must be known token names (see the contract). Unknown keys are an error. |

### PluginConfig

| Field | Type | Rules |
|-------|------|-------|
| version | semver range | Required. The installed plugin's version must satisfy it (FR-019). |
| settings | object | Plugin-level defaults, validated against the plugin's settings schema |
| refreshInterval, cacheWindow, timeout | duration? | Override the manifest and global defaults |

### Dashboard

| Field | Type | Rules |
|-------|------|-------|
| id | slug `[a-z0-9-]+` | Unique |
| title | string | |
| theme | `ThemeSpec?` | Overrides the global theme |
| items | `Placement[]` | No overlaps and nothing outside the grid (FR-002b) |

### Placement

Either a WidgetPlacement or a BlockUse.

| Field | Type | Rules |
|-------|------|-------|
| id | slug | Required. Unique among its siblings (FR-002a). |
| at | `[column, row]` | 1-based. `column` is between 1 and 12. |
| size | `[width, height]` | `column + width - 1` must be 12 or less |
| **WidgetPlacement**: plugin | PluginId | |
| **WidgetPlacement**: title | string? | |
| **WidgetPlacement**: settings | object? | Merged over the plugin-level settings, then validated |
| **BlockUse**: use | BlockName | Must exist (US4-5) |
| **BlockUse**: with | object? | Keys must be parameters the block declares |

### Block

| Field | Type | Rules |
|-------|------|-------|
| params | `Record<string, {default?: string}>` | Parameters that can be overridden per use |
| items | `Placement[]` | Laid out on the block's own 12-column sub-grid. A nesting cycle is an error. |

Parameter values are substituted with `${name}` in string fields of the block's items.

### WidgetInstance (derived)

A widget after blocks have been expanded and settings merged.

| Field | Type | Notes |
|-------|------|-------|
| path | `WidgetPath` | `dashboardId/[blockUseId/...]widgetId`. This is the stable key for tracked refs. |
| pluginId | PluginId | |
| settings | object | Merged and validated. Secrets are still `{env}` references. |
| status | `"ok" \| "invalid" \| "plugin-missing" \| "plugin-incompatible" \| "plugin-refused"` | Controls the placeholder shown (FR-019) |

### LoadedPlugin (runtime)

| Field | Type | Notes |
|-------|------|-------|
| manifest | `PluginManifest` | Read from `dist/opsdash.manifest.json`, which includes `settingsSchema` and `referenceSchema`. See [contracts/plugin-api.md](./contracts/plugin-api.md) §1. |
| state | `"loaded" \| "refused"` | |
| refusal | string? | Incomplete manifest, API version, duplicate identifier, mutating capability, or missing mock source (FR-016, FR-049) |
| module | server module | Present only when loaded |

## B. Store model (SQLite through Drizzle)

The store holds no configuration, no credentials, and no item content or status (FR-029).

### `tracked_ref`

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | Primary key, auto-increment |
| widget_path | text | Not null. Indexed. |
| plugin_id | text | Not null |
| ref_key | text | Not null. The plugin's canonical key, for example `ITEM-42` |
| ref | text (JSON) | Not null. The plugin-defined identifier object, validated by the plugin's reference schema. |
| created_at | integer (unix ms) | Not null |
| | | **Unique(widget_path, ref_key)**, so there are no duplicates within a widget (FR-032) |

### `ref_link`

| Column | Type | Constraints |
|--------|------|-------------|
| id | integer | Primary key |
| from_ref_id | integer | Foreign key to `tracked_ref.id`, **ON DELETE CASCADE** |
| to_ref_id | integer | Foreign key to `tracked_ref.id`, **ON DELETE CASCADE** |
| created_by | text | Plugin identifier |
| created_at | integer | |
| | | **Unique(from_ref_id, to_ref_id)**, and a check that `from_ref_id != to_ref_id` |

Links can be queried from either end (US6-2). Deleting either reference removes the link.

### `plugin_state`

| Column | Type | Constraints |
|--------|------|-------------|
| plugin_id | text | Primary key part |
| key | text | Primary key part |
| value | text (JSON) | Not null |
| updated_at | integer | |

The plugin API only ever gives a plugin access to rows with its own `plugin_id` (FR-021).

### `__drizzle_migrations`

drizzle-kit's migration journal. It is used for the "store is newer than the host" check
(FR-031).

## C. Lifecycles and rules

### Tracked reference lifecycle

```text
(input) --parseReference ok--> stored --untrack--> deleted
   |                              |
   +--invalid/not found--> rejected (nothing stored, 422)
                                  +--widget path gone from a valid config--> deleted + logged
```

**Deletion rule for removed widgets** (FR-032, US6-11/12). After a config (re)load, a
widget path P that has stored refs is deleted only when all of these hold:

1. `ConfigSet.valid` is true, meaning every file parsed.
2. P's top-level dashboard is not present in the loaded set, **or** that dashboard and every
   block on P's expansion chain validated with no errors in scope.
3. P is not among the resolved widget instances.

If any condition fails, the refs are kept for this load. Each deletion is logged as
`{event: "refs.deleted", widgetPath, count}`.

### Plugin lifecycle

```text
discovered --manifest invalid/incompatible/duplicate/mutating/no-mock--> refused
discovered --ok--> loaded --server module throws on import--> refused
loaded --dist changed (dev)--> reloading --> loaded | refused
```

### Widget data states (sent to the browser)

`loading` → `ok` | `empty` | `error` | `stale` (last success is older than the refresh
interval and the latest fetch failed) | `timeout`. When only some references fail, the
state is per reference inside `ok` (FR-024).

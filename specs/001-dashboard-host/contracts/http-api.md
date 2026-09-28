# Contract: Host HTTP API

This is the internal contract between the host server and the web UI. It is also used by
the E2E tests. Everything is served on one port (default 4400). There is no built-in
authentication (FR-042).

## Read endpoints

| Method and path | Response |
|-----------------|----------|
| `GET /` | Web UI (`index.html` with the import map, §R4) |
| `GET /api/meta` | `{ version, pluginApiVersion, mock: boolean }`. The UI uses `mock` to show the badge (FR-050). |
| `GET /api/dashboards` | `[{ id, title, status: "ok" \| "invalid", errorCount }]` |
| `GET /api/dashboards/:id` | `ResolvedDashboard` (below), or 404 |
| `GET /api/status` | `{ config: { files, errors: ConfigError[] }, plugins: [{ id, version, state, refusal? }] }` |
| `GET /schema/config.v1.json` | The config JSON Schema (FR-013) |
| `GET /plugins/:id/client.js`, `GET /plugins/:id/style.css` | The plugin's client bundle and extracted CSS, or 404 if the plugin is not loaded |
| `GET /vendor/<module>.js` | Import-map shims that re-export the page's own `preact`, `preact/hooks`, `preact/jsx-runtime`, and `@preact/signals` instances (see research R4) |
| `GET /healthz` | `{ status: "healthy" \| "degraded" \| "unhealthy", reasons: string[] }`, with 200 for healthy or degraded and 503 for unhealthy (FR-047) |

```ts
type ResolvedDashboard = {
  id: string; title: string;
  theme: { mode: "light" | "dark" | "system"; tokens: Record<string, string> }; // merged
  errors: ConfigError[];                       // non-empty → UI shows errors instead of content
  items: ResolvedItem[];                        // grid tree
};
type ResolvedItem =
  | { kind: "widget"; path: string; at: [number, number]; size: [number, number];
      title?: string; pluginId: string; clientUrl?: string; styleUrl?: string; trackable: boolean;
      status: "ok" | "invalid" | "plugin-missing" | "plugin-incompatible" | "plugin-refused";
      placeholder?: { pluginId: string; requiredVersion?: string; reason: string };
      settings: object /* secrets removed */ }
  | { kind: "block"; id: string; at: [number, number]; size: [number, number];
      items: ResolvedItem[] };
```

## Tracking

The widget path is URL-encoded as one segment, for example `overview%2Fteam-a%2Fitems`.

| Method and path | Body | Responses |
|-----------------|------|-----------|
| `GET /api/widgets/:path/items` | none | 200 `[{ refKey, ref }]` (the widget's tracked list); 404 when the widget is unknown |
| `POST /api/widgets/:path/items` | `{ input: string }` | 201 `{ refKey, ref }`; 409 when already tracked in this widget; 422 `{ error }` when the plugin rejects the input; 404 when the widget is unknown; 400 when the plugin has no `track` capability |
| `DELETE /api/widgets/:path/items/:refKey` | none | 204, or 404 |

After a successful change, the widget's data is re-fetched straight away, through the
batched pipeline, and pushed to every viewer.

## Server-sent events

`GET /api/events?dashboard=:id` opens one stream per viewer and subscribes it to one
dashboard. The set of visible widgets is the union over all open streams.

| Event | Data | When |
|-------|------|------|
| `snapshot` | `{ widgets: WidgetData[] }` | Right after connecting. Covered widgets get their latest results. Uncovered widgets get `loading` and are fetched immediately. |
| `widget-data` | `WidgetData` | After each fetch that affects a widget on this dashboard |
| `dashboard-changed` | `{ id }` | The config reloaded and this dashboard changed. The UI re-fetches `/api/dashboards/:id`. |
| `dashboards-changed` | none | The list of dashboards changed |
| `plugin-reloaded` | `{ id, clientUrl }` | Dev hot reload. The UI re-imports the module with a cache-busting query and re-mounts the widgets. |

```ts
type WidgetData = {
  path: string;
  state: "loading" | "ok" | "empty" | "error" | "stale" | "timeout";
  items: Array<{ refKey: string; ref: object; data?: unknown; error?: string }>;
  fetchedAt?: number; lastSuccessAt?: number; error?: string;
};
```

A new subscriber never adds a source request for a widget that the current cycle already
covers (US5-7, SC-004).

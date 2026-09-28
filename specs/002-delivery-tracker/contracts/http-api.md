# Contract: Host HTTP API additions

These additions build on [001 http-api.md](../../001-dashboard-host/contracts/http-api.md).

| Method and path | Body | Responses |
|-----------------|------|-----------|
| `POST /api/widgets/:path/actions/:name` | JSON payload | 200 `{ ok: true, message? }`. 422 `{ error }` when the action returns an error. 404 when the widget or action is unknown. 400 when the plugin lacks the `actions` capability. The widget's data is re-run straight after a successful action. |
| `GET /api/widgets/:path/items` | none | Unchanged, except that each entry now also has `plugin` and `id`. |
| `DELETE /api/widgets/:path/items/:refKey?plugin=<id>&cascade=1` | none | `plugin` defaults to the widget's plugin. `cascade=1` also removes linked references in the widget that end up with no links. Returns 204, or 404. |

**Server-sent events**: a `widget-data` payload for a composite widget carries `items[].plugin`,
`items[].id`, `links` and `meta` (see [data-model.md](../data-model.md) §Composite widget data).
Each item also carries its own `state` and `lastSuccessAt`, so freshness can differ between
plugins.

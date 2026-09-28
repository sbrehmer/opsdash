# Contract: Configuration Format v1 (YAML)

This is the operator-facing contract. The machine-readable form is generated with
`z.toJSONSchema()` and published at `GET /schema/config.v1.json`, and the docs include it
(FR-013). Data types and validation rules are in [data-model.md](../data-model.md) §A.

## Root file

The root is `opsdash.yaml` in the config directory.

```yaml
# yaml-language-server: $schema=http://localhost:4400/schema/config.v1.json
version: 1

include:                # optional; paths relative to this file; included files may include
  - blocks.yaml
  - dashboards/team.yaml

defaults:               # optional
  refreshInterval: 60s
  cacheWindow: 30s
  timeout: 10s

theme:                  # optional global theme
  mode: system          # light | dark | system
  tokens:
    color-accent: "#4f7cff"

plugins:
  reference:
    version: "^1.0.0"   # semver range; required
    refreshInterval: 30s
    settings:           # plugin-level defaults (validated against the plugin's schema)
      apiToken: { env: REFERENCE_TOKEN }   # secret-typed: must be { env: NAME }
    mock:               # optional; only used in mock mode (--mock / OPSDASH_MOCK=1)
      latencyMs: 200
      notFound: ["X-404"]
      errorRate: 0

dashboards:
  - id: overview
    title: Overview
    theme: { mode: dark }
    items:
      - id: open-items          # widget id: required, unique among siblings
        plugin: reference
        title: Open items
        at: [1, 1]              # [column 1-12, row >= 1]
        size: [6, 4]            # [width, height] in grid units
        settings: { view: list }
      - id: team-a              # block use
        use: team-panel
        at: [7, 1]
        size: [6, 4]
        with: { title: "Team A" }
```

## Included file

An included file can contain any of `include`, `plugins`, `dashboards`, and `blocks`. It
can't contain `version`, `defaults`, or `theme`, which are only allowed in the root file.
Entries from all files are merged. A duplicate dashboard ID, block name, or plugin key is an
error that names both locations.

```yaml
blocks:
  team-panel:
    params:
      title: { default: "Team" }
    items:                      # laid out on the block's own 12-column sub-grid
      - id: items
        plugin: reference
        title: "${title} items"
        at: [1, 1]
        size: [12, 4]
```

## Widget paths

A widget path is the stable key for tracked items. It joins placement IDs from the
dashboard down to the widget:

| Placement | Path |
|-----------|------|
| `open-items` directly on `overview` | `overview/open-items` |
| `items` inside block use `team-a` on `overview` | `overview/team-a/items` |

Renaming any part of the path counts as removing the widget and adding a new one. In a
valid config, the old widget's tracked items are deleted (data-model §C).

## Design tokens that can be overridden

- **Color**: `color-bg`, `color-surface`, `color-text`, `color-text-muted`, `color-border`,
  `color-accent`, `color-ok`, `color-warn`, `color-error`
- **Font**: `font-family`, `font-family-mono`, `font-size-base`
- **Spacing**: `space-unit`, `grid-gap`
- **Radius**: `radius`
- **Motion**: `motion-duration`

Each token is set separately for light and dark. `tokens` applies to both modes, and
`tokens-light` and `tokens-dark` apply to a single mode. Any other key is a validation
error.

## Error format

Every error is reported in the log, in `GET /api/status`, and in place of the affected
dashboard's content, like this:

```text
dashboards/team.yaml:14:9  dashboards[0].items[2].size
  Widget "deploys" extends to column 14; the grid has 12 columns.
```

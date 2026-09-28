# Opsdash Constitution

## Purpose

Opsdash is a lightweight, plugin-based dashboard that tracks items held in external source
systems and the relationships between them. Every source integration is a plugin, and all
plugins follow the same data pattern (see Plugin Data Pattern). Integration-specific details
belong in each plugin's feature spec, not in this constitution. A major objective is to send
as few requests to source systems as possible.

## Core Principles

### I. Plugin-First Extensibility

Opsdash is a lightweight host. Every widget or dashboard element, including the default
ones, is delivered as a plugin.

- Each widget, data source integration, and visual element MUST come from a plugin that uses
  the public plugin API. The core MUST NOT contain widget-specific logic.
- The core covers only layout, the plugin lifecycle, config-file loading, persistence,
  theming, and the plugin API.
- Built-in plugins MUST use the same public API as third-party plugins, with no private
  hooks.
- A plugin MUST declare its metadata, its configuration schema, and the API version it
  targets. The host MUST refuse an incompatible plugin and show a clear message saying why.
- A plugin that fails to load, crashes, or times out MUST be isolated to its own widget slot,
  which shows an error state.

**Rationale**: Extensibility is the product. A core that uses its own public API keeps that
API complete and keeps the core small.

### II. File-Based Configuration & Composable Blocks

All configuration lives in declarative config files. The UI is not a configuration tool.

- One consolidated configuration defines the dashboards, layout, widget placement and
  sizing, theme, reusable template blocks, and each plugin's settings. It MAY be split
  across several files through includes. It MUST be human-readable and keep a format
  version.
- The running UI MUST NOT provide editors for layout, appearance, composition, or plugin
  settings.
- A template block is a named arrangement of widgets. A block MUST be reusable across
  dashboards and inside other blocks.
- Config files refer to plugins by stable identifier and version range. They MUST NOT embed
  plugin code.
- Config files MUST be validated against the host schema and each plugin's declared schema
  when they are loaded. An error MUST name the file, the location, and the problem. An
  invalid section MUST NOT take down valid dashboards.
- If a block needs a plugin that is missing or incompatible, it still loads, with a visible
  placeholder naming the missing dependency.
- Changing the config format MUST come with a migration for the previous format.
- Config files are the only source of truth for configuration. The database MUST NOT hold
  configuration.

**Rationale**: Files can be version-controlled, reviewed, diffed, and shared. Keeping one
source of truth makes setups reproducible and keeps the UI minimal.

### III. Read-Only by Default & No Stored Credentials

Opsdash observes systems. It does not operate them, and it never persists secrets.

- Plugins and the core MUST treat connected systems as read-only by default.
- A plugin that performs a mutating action MUST declare that capability in its manifest.
  The config MUST explicitly enable it for that plugin instance. Each action MUST ask for
  confirmation that names the target and the effect, and MUST be written to the action log.
- Credentials and secrets MUST NOT be stored anywhere by Opsdash: not in config files, not in
  the database, not in logs, and not in browser storage. They come only from environment
  variables or env files, and config files refer to them by variable name.
- Secrets MUST stay server-side, MUST NOT reach the browser, and MUST be redacted from errors
  and logs.
- A feature that adds mutating behaviour MUST justify it in the plan's Constitution Check.

**Rationale**: A dashboard is shared and left open on screens. Accidental changes and leaked
credentials are the worst failures it can cause.

### IV. Lightweight Simplicity: YAGNI, Don't Reinvent the Wheel

Opsdash MUST stay small to run and small to maintain.

- Build what current specs require. Extension points (such as other databases) are designed
  for, not implemented ahead of need.
- Do not hand-write what a mature, well-maintained library already does well (for example
  ORM/query building, migrations, schema validation, config parsing, templating, and
  routing). Prefer a dependency when it removes a lot of code or boilerplate.
- Each new runtime dependency needs a short justification in the plan: what it replaces, and
  that it is maintained, widely used, and suitably licensed. Hand-rolling something a
  library provides needs a justification too.
- Opsdash MUST run as a single deployable. Its only required data store is an embedded SQLite
  file. No external database server or message broker may be required.
- The first implementation plan sets a core bundle-size and startup budget. A change that
  exceeds it MUST be justified or reverted.

**Rationale**: Little to deploy and little code to own. Custom boilerplate costs more over
time than a well-chosen dependency does.

### V. Beautiful, Minimalist UI

The interface MUST be calm, uncluttered, and consistent.

- Visual design MUST come from host-provided design tokens (color, type, spacing, radius,
  motion). The config may select and override tokens. Plugins MUST use these tokens and MUST
  NOT ship their own global styles.
- Screens show only what the config defines. Controls appear only when needed.
- Themes MUST include at least light and dark.
- The UI MUST be responsive from phone to wall-display widths and MUST meet WCAG 2.2 AA.
- Every widget MUST have designed loading, empty, error, and stale-data states. The host
  provides defaults that plugins can use.

**Rationale**: A dashboard is used for glanceable understanding. Clean, consistent design
makes it trustworthy.

## Persistence, Plugin Contract & Technical Constraints

- **SQLite** is the required store for tracked-item references and runtime data. It holds no
  configuration and no credentials. Runtime data covers the action log and plugin state.

### Plugin Data Pattern

Every plugin MUST follow this pattern. No exceptions for built-in plugins.

- **Persist references only.** A plugin stores just the identifiers needed to find each
  tracked item again in its source system, plus the links between items. It MUST NOT
  persist the items' content or status.
- **Link through the host.** References from different plugins MUST be linkable to each
  other. Plugins create links through the host storage API and MUST NOT depend on another
  plugin's internals.
- **Query live.** Item details and status are fetched live from the source system when they
  are displayed. The only caching allowed is short-lived, to cut request volume and respect
  rate limits.
- **Batch every fetch.** A plugin MUST resolve a list of references with as few requests as
  the source allows, using whatever batching mechanism it offers: a query language that
  fetches many items at once, endpoints that accept several identifiers, or search and
  filter queries. Per-item requests in a loop (N+1) are allowed only when the source has no
  batch mechanism. The plan MUST record that as a justified deviation.
- **Host-coordinated fetching.** In each refresh cycle, the host MUST collect the data needs
  of every visible widget, de-duplicate identical requests, and hand each plugin one batched
  fetch per cycle rather than one per widget.

### Storage & Plugin Contract
- All database access MUST go through a single storage layer built on an established
  multi-dialect ORM or query builder, so other databases can be added later. A home-grown
  database abstraction is not allowed. Code outside the storage layer MUST NOT issue SQL.
- Schema changes MUST use versioned migrations from an established migration tool. They run
  automatically at startup.
- Only SQLite is implemented until a spec requires another database.
- Plugins persist data only through a host-provided, namespaced storage API.
- The plugin API has its own semantic version. A breaking change bumps its MAJOR version and
  comes with a migration guide.
- The plugin manifest MUST declare: identifier, version, target API version, configuration
  schema, capabilities (including mutating ones), required environment variables, and
  refresh behaviour.
- Plugins fetch data through host data-access helpers where those exist, which handle
  batching, de-duplication, caching, rate limiting, secret injection, and stale-data
  signalling. The plugin API MUST let a plugin accept a list of item references and resolve
  them in a single batched call. Plugins MUST NOT touch
  the host's or other plugins' DOM, state, or storage except through the API.

## Development Workflow & Quality Gates

- Features go through the Spec Kit flow (specify → clarify → plan → tasks → implement). Each
  plan includes a Constitution Check against this document.
- Changes to the plugin API or the config format MUST include contract tests against a
  reference plugin and a reference config. Schema changes MUST include migration tests
  against SQLite.
- UI changes are checked against Principle V: tokens, both themes, all widget states, and
  accessibility.
- Reviews MUST reject:
  - widget-specific logic in the core
  - privileged access for built-in plugins
  - in-app configuration editors
  - configuration or credentials stored outside config files and environment variables
  - database access outside the storage layer
  - unbatched per-item requests to a source that supports batching
  - dependencies or hand-rolled code without a justification

## Governance

- This constitution overrides other project practices. Conflicting guidance MUST be
  updated.
- Amendments are made through `/speckit-constitution`.
- A plan that deviates from this document MUST record the deviation and its justification in
  the plan's Complexity Tracking.
- While the constitution is in its first iteration, amendments are applied in place without
  bumping the version. Semantic versioning starts once it is declared stable.

**Version**: 1.0.0 (first iteration) | **Ratified**: 2026-09-27 | **Last Amended**: 2026-09-27

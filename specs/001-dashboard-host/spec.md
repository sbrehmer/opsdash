# Feature Specification: Core Dashboard Host

**Feature Branch**: `001-dashboard-host`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "Core dashboard host for Opsdash, with no source-system plugins yet. It loads dashboards from declarative config files (layout, widget placement, theme, reusable template blocks, plugin settings, includes), validates them with clear file/location errors, and renders them in a minimalist, responsive UI with light and dark themes and design tokens. It provides the plugin API and lifecycle: manifest, API versioning, isolation of failing plugins, and a placeholder when a plugin is missing. It provides a SQLite storage layer behind an ORM with migrations, used for item references, links between them, and plugin state. It reads secrets only from environment variables or env files. Each refresh cycle collects the data needs of the visible widgets, merges identical requests, and hands each plugin one batched fetch. Include a minimal reference plugin to prove out the plugin contract."

## Clarifications

### Session 2026-09-27

- Q: Which file format should operators write the config files in? → A: YAML
- Q: When an item is tracked through a widget, where should it show up? → A: Per widget
  instance: each widget has its own tracked list (revised from an earlier "global per plugin"
  answer)
- Q: When a block is used in several places, do its widgets share one tracked list? → A: No.
  Each use of the block has its own tracked lists.
- Q: What happens to tracked items when their widget is removed or renamed in config? → A:
  They are deleted.
- Q: With several viewers, are sources queried once for everyone or once per viewer? → A:
  One shared server-side refresh cycle covering widgets visible to any viewer, with results
  pushed to all open browsers
- Q: How are widget positions and sizes expressed in config? → A: A 12-column grid (column,
  row, width, height in grid units) that collapses to a single stacked column on narrow
  screens
- Q: What should Opsdash expose for health and diagnosis? → A: Structured logs to standard
  output, plus a health-check endpoint

## User Scenarios & Testing *(mandatory)*

The primary actor is the **operator**: the person who writes the config files, runs Opsdash,
and looks at the dashboards. A secondary actor is the **plugin author**, who builds plugins
against the plugin contract.

### User Story 1 - Define a dashboard in a config file and view it (Priority: P1)

The operator writes a config file that describes a dashboard: its layout, which widgets
appear where and at what size, the theme, and the settings for each widget's plugin. The
operator starts Opsdash, opens it in a browser, and sees the dashboard rendered as described.
The widgets come from the bundled reference plugin.

**Why this priority**: This is the smallest version of Opsdash that delivers value: a
config-defined dashboard that renders. Everything else builds on it.

**Independent Test**: Start Opsdash with an example config file that uses the reference
plugin. Open the dashboard and confirm that every widget appears in the configured
position and size, with the configured theme.

**Acceptance Scenarios**:

1. **Given** a valid config file that defines one dashboard with three reference-plugin
   widgets, **When** the operator opens the dashboard, **Then** all three widgets appear in
   the configured positions and sizes and show their data.
2. **Given** a config that defines several dashboards, **When** the operator opens Opsdash,
   **Then** they can navigate between the dashboards.
3. **Given** a dashboard is configured for the dark theme, **When** it is opened, **Then**
   it renders in the dark theme. Changing the config to light and reloading renders it in
   the light theme.
4. **Given** the config sets design-token overrides (for example the accent color),
   **When** the dashboard is opened, **Then** the overrides are applied consistently to the
   host and to every widget.
5. **Given** a dashboard is open, **When** the operator changes a config file,
   **Then** the change appears without restarting Opsdash.
6. **Given** a dashboard is open, **When** the operator looks for a way to edit layout,
   appearance, or settings in the UI, **Then** there is none. Configuration is done only
   in files.

---

### User Story 2 - Get clear errors for invalid configuration (Priority: P1)

The operator makes a mistake in a config file, such as a typo, a missing required field, a
value of the wrong type, or a reference to an undefined block. Opsdash reports exactly
which file, where in it, and what is wrong. Dashboards that are unaffected keep working.

**Why this priority**: Config files are the only way to configure Opsdash. If errors are
unclear, the product can't be used.

**Independent Test**: Load a set of deliberately broken config files. Confirm that each
error names the file, the location, and the problem, and that valid dashboards still render.

**Acceptance Scenarios**:

1. **Given** a config file with a missing required field, **When** it is loaded, **Then**
   the error names the file, the location (line, or path within the document), and the
   missing field.
2. **Given** plugin settings that break the plugin's declared settings schema, **When** the
   config is loaded, **Then** the error names the file, the location, the plugin, and the
   rule that was broken.
3. **Given** one dashboard is invalid and another is valid, **When** Opsdash loads, **Then**
   the valid dashboard renders normally and the invalid one shows its errors instead of
   content.
4. **Given** a config file with a syntax error, **When** it is loaded, **Then** Opsdash does
   not crash and reports the file and position of the syntax error.
5. **Given** the config is edited while Opsdash is running and the edit introduces an error,
   **When** the change is detected, **Then** the error is reported, and the affected
   dashboard shows the error instead of silently showing stale content.

---

### User Story 3 - Plugins load safely and fail in isolation (Priority: P1)

Opsdash discovers the available plugins and reads each one's manifest. It loads compatible
plugins and refuses incompatible ones with a clear reason. When a plugin fails or is
missing, only that plugin's widgets are affected.

**Why this priority**: The whole product is made of plugins (Constitution Principle I). The
host must be safe to extend before any real plugin is written.

**Independent Test**: Use the reference plugin plus test variants of it: one that declares
an unsupported API version, one that throws an error, one that never responds, and a config
that refers to a plugin that isn't installed. Confirm that each case affects only its own
widget slots.

**Acceptance Scenarios**:

1. **Given** a plugin whose manifest declares an API version the host doesn't support,
   **When** Opsdash starts, **Then** the plugin is not loaded and the operator sees which
   plugin was refused and why.
2. **Given** a plugin that raises an error while loading data, **When** its widget refreshes,
   **Then** that widget shows an error state and every other widget keeps working.
3. **Given** a plugin that doesn't respond within the refresh timeout, **When** the refresh
   cycle runs, **Then** its widgets show a timeout or stale state and the rest of the
   dashboard is not delayed.
4. **Given** a config that refers to a plugin that isn't installed, or an installed plugin
   whose version is outside the configured version range, **When** the dashboard is opened,
   **Then** the widget slot shows a placeholder naming the missing plugin and the required
   version.
5. **Given** a plugin manifest is missing required fields, **When** Opsdash starts, **Then**
   the plugin is refused and the problem is named.

---

### User Story 4 - Reuse template blocks and split config across files (Priority: P2)

The operator defines a template block once (a named arrangement of widgets with their
settings) and reuses it on several dashboards and inside other blocks. The operator splits a
large configuration into several files using includes.

**Why this priority**: Reuse is a key part of the product's value, but a single dashboard is
useful without it.

**Independent Test**: Define one block that is used on two dashboards and nested in a
second block, spread across three included files. Confirm that it renders identically
everywhere and that changing the block in one place updates every use.

**Acceptance Scenarios**:

1. **Given** a block is defined once and used on two dashboards, **When** both are opened,
   **Then** the block renders the same way on both.
2. **Given** a block is used inside another block, **When** the outer block is rendered,
   **Then** the inner block appears in place.
3. **Given** a block is used with per-use overrides that the block allows (for example a
   title), **When** it is rendered, **Then** the overrides apply only to that use.
4. **Given** blocks that include each other in a cycle, or files that include each other in
   a cycle, **When** the config is loaded, **Then** the cycle is reported with the files
   involved and nothing hangs.
5. **Given** a use of a block name that isn't defined, **When** the config is loaded,
   **Then** the error names the file, the location, and the unknown block name.
6. **Given** a block that needs a plugin that isn't installed, **When** it is rendered,
   **Then** the block still appears, with a placeholder where that plugin's widgets would
   be.

---

### User Story 5 - Batched, de-duplicated refresh cycles (Priority: P2)

On each refresh, the Opsdash server collects what every widget visible to any viewer needs,
merges identical requests, gives each plugin a single batched fetch, and pushes the results
to every open browser. The number of requests to source systems stays as low as possible,
however many widgets show related data and however many people are watching.

**Why this priority**: The constitution makes minimizing source requests a major objective.
This behaviour is part of the plugin contract, so it has to exist before real plugins are
written.

**Independent Test**: Show ten reference-plugin widgets that between them ask for 25
references, some of them duplicates. Count the reference plugin's simulated source
requests: exactly one batched request per refresh cycle, with each reference requested once.

**Acceptance Scenarios**:

1. **Given** several visible widgets from the same plugin, **When** a refresh cycle runs,
   **Then** that plugin receives exactly one fetch per source instance containing all the
   references needed, with no duplicates.
2. **Given** two widgets ask for the same reference, **When** a refresh cycle runs, **Then**
   the reference is requested once and both widgets show the result.
3. **Given** a widget is not visible (for example it is on a dashboard that isn't open),
   **When** a refresh cycle runs, **Then** its data needs are not included.
4. **Given** a reference was fetched within the configured short-lived cache window,
   **When** another cycle runs inside that window, **Then** it is served from the cache and
   not requested again.
5. **Given** a batched fetch returns results for some references and errors for others,
   **When** the results are delivered, **Then** each widget shows its own data, or the error
   for only the references that failed.
6. **Given** three viewers have the same dashboard open, **When** a refresh cycle runs,
   **Then** the source is queried as if there were one viewer, and all three browsers
   receive the same results.
7. **Given** a viewer opens a dashboard whose widgets are already covered by the running
   cycle, **When** it loads, **Then** it shows the latest results right away with no extra
   source request.

---

### User Story 6 - Persist item references, links, and plugin state (Priority: P2)

Opsdash stores the identifiers of tracked items, the links between them, and plugin state,
and keeps them across restarts. Item details are never stored. They are always fetched live.

**Why this priority**: Real plugins will depend on this. The reference plugin proves it out
now.

**Independent Test**: With the reference plugin, add item references and a link between
them, restart Opsdash, and confirm the references and link are still there while item
details are fetched live again.

**Acceptance Scenarios**:

1. **Given** item references and a link between them have been added, **When** Opsdash
   restarts, **Then** the references and the link are unchanged.
2. **Given** references owned by two different plugins, **When** one is linked to the other
   through the host, **Then** the link is stored and can be queried from either side.
3. **Given** a plugin stores state, **When** another plugin tries to read it, **Then** it is
   denied. Each plugin's state is private to its own namespace.
4. **Given** Opsdash starts with a store created by an earlier version, **When** it starts,
   **Then** pending store migrations apply automatically and existing data is preserved.
5. **Given** an item reference is stored, **When** the store's contents are inspected,
   **Then** it contains only identifiers, links, and plugin state, and no item content,
   status, configuration, or credentials.
6. **Given** a widget from a plugin that tracks items, **When** the operator uses its
   "track item" action and enters an item identifier, **Then** the plugin validates the
   identifier, the reference is stored in that widget instance's tracked list, and the item
   appears with live details in that widget only.
7. **Given** an item that is already tracked in a widget, **When** the operator tracks it
   again in the same widget, **Then** no duplicate is created and the operator is told it is
   already tracked. Tracking the same item in a different widget is allowed.
8. **Given** an identifier the plugin rejects (bad format or not found in the source),
   **When** the operator submits it, **Then** nothing is stored and the reason is shown
   inline.
9. **Given** a tracked item, **When** the operator uses its "untrack" action, **Then** the
   reference is removed from that widget's list, along with links that exist only because of
   it. Other widgets that track the same item are unaffected.
10. **Given** two widgets track the same item, **When** a refresh cycle runs, **Then** the
    item is requested from the source only once (FR-023).
11. **Given** a widget with tracked items is removed from a valid config, or its identifier
    changes, **When** the config reloads, **Then** its tracked references and their links
    are deleted, and the deletion is logged with the widget identifier and the number of
    references removed.
12. **Given** a config edit makes a dashboard or block invalid, **When** the config reloads,
    **Then** no tracked references are deleted for the widgets in that invalid section.
13. **Given** a block is used on two dashboards, **When** an item is tracked in the block's
    widget on one dashboard, **Then** it does not appear in the same widget on the other
    dashboard.

---

### User Story 7 - Secrets come only from the environment (Priority: P3)

The operator supplies credentials for plugins through environment variables or an env file.
Config files refer to them by variable name only. Opsdash never writes a secret anywhere and
never sends one to the browser.

**Why this priority**: The reference plugin needs no real credentials, but the mechanism
must exist and be proven before real integrations arrive.

**Independent Test**: Configure the reference plugin with a secret by variable name, run it,
and then search config files, the store, logs, error output, and browser-visible responses
for the secret's value. It must appear in none of them.

**Acceptance Scenarios**:

1. **Given** a plugin setting refers to an environment variable by name, **When** the
   plugin runs, **Then** it receives the variable's value on the server side.
2. **Given** a required environment variable (declared in the plugin manifest) is missing,
   **When** Opsdash starts or the config is loaded, **Then** the operator sees which variable
   is missing for which plugin, and that plugin's widgets show an error state.
3. **Given** an env file is configured, **When** Opsdash starts, **Then** its variables are
   available the same way as process environment variables. Process environment variables
   take precedence.
4. **Given** a plugin error message contains a secret value, **When** it is logged or shown,
   **Then** the value is redacted.
5. **Given** a config file contains what appears to be a literal secret value in a
   secret-typed setting, **When** it is loaded, **Then** it is rejected with an error telling
   the operator to use an environment variable reference.

---

### User Story 8 - Build a plugin against a documented contract (Priority: P3)

A plugin author uses the reference plugin and the plugin contract documentation to
understand how to build a new plugin: the manifest, the settings schema, batched fetching,
widget states, storage of references and state, and theming through design tokens.

**Why this priority**: This enables all the later plugin stories. It is proven by the
reference plugin, not by a real integration.

**Independent Test**: A developer who hasn't seen the codebase before copies the reference
plugin, renames it, changes its widget, and loads it successfully, using only the contract
documentation.

**Acceptance Scenarios**:

1. **Given** the reference plugin, **When** the contract tests run against it, **Then** they
   pass. They cover the manifest, version negotiation, batched fetch, partial failure, and
   storage.
2. **Given** a copy of the reference plugin with a new identifier, **When** it is added to
   the plugin location and referenced in config, **Then** it loads and renders without any
   change to the host.
3. **Given** a plugin widget, **When** it renders in loading, empty, error, and stale
   states, **Then** it uses the host's default state presentations unless it provides its
   own.

---

### Edge Cases

- No config files are present. Opsdash starts and shows a helpful empty state explaining
  where to put the config.
- Config files exist but define no dashboards. The same guidance is shown.
- Two dashboards or blocks share an identifier. An error names both locations.
- Two widgets overlap on the grid, or a widget extends past column 12. A validation error
  names both placements, or the out-of-bounds one.
- Two installed plugins share an identifier. Both are refused and the conflict is reported.
- A config file is deleted or renamed while Opsdash is running. Its dashboards disappear, or
  show include errors, without crashing.
- The store file is missing. It is created on startup.
- The store file is unreadable, corrupt, or written by a newer, incompatible version.
  Opsdash refuses to start with a clear message and does not overwrite the file.
- A batched fetch returns more or fewer results than were requested. Unmatched references
  show an error state and extra results are ignored.
- The source's maximum batch size is smaller than the number of references. The plugin
  declares that limit, and the host splits the batch into the fewest chunks possible.
- A refresh cycle is still running when the next one is due. The next cycle is skipped or
  merged, never run concurrently for the same plugin.
- Very small screens (360px wide) and wall displays (3840px wide). The layout stays usable
  without horizontal scrolling.
- A plugin manifest declares a mutating capability. It is refused in this feature, with a
  message that mutating capabilities are not yet supported.

## Requirements *(mandatory)*

### Functional Requirements

**Configuration**

- **FR-001**: System MUST load all configuration from declarative config files written in YAML
  (comments allowed), located in an operator-specified configuration location.
- **FR-002**: Config MUST be able to define multiple dashboards, each with a layout, widget
  placement and sizing, a theme choice, design-token overrides, and per-widget plugin
  settings. A dashboard's config `items` are placements, each either a widget or a block
  use.
- **FR-002a**: Every widget instance MUST have an explicit identifier in config, unique within
  its dashboard or block. Duplicates are configuration errors (FR-008). Tracked references
  are keyed to this identifier (or to the path, for widgets placed through a block use).
- **FR-002b**: Layout MUST use a 12-column grid. Each widget or block use sets its column,
  row, width, and height in grid units. On narrow viewports the grid MUST collapse to a single
  column, stacked in row-then-column order. Overlapping or out-of-bounds placements MUST be
  reported as configuration errors (FR-008).
- **FR-003**: Config MUST support includes, so that configuration can be split across
  multiple files.
- **FR-004**: Config MUST support named template blocks that can be used on any dashboard
  and inside other blocks, with optional per-use overrides that the block declares.
- **FR-005**: Config MUST refer to plugins by stable identifier and an allowed version
  range, and MUST NOT contain plugin code.
- **FR-006**: Config MUST carry a format version. This feature defines version 1, and an
  unknown or unsupported version MUST be rejected with an error naming the supported
  versions. Every later format version MUST ship with an automatic migration from the
  previous one.
- **FR-007**: System MUST validate config against the host schema, and plugin settings
  against each plugin's declared settings schema.
- **FR-008**: Every configuration error MUST name the file, the line and column plus the path
  within the document, and the problem, in plain language.
- **FR-009**: An invalid dashboard or block MUST NOT prevent valid dashboards from
  rendering.
- **FR-010**: System MUST detect include cycles and block-nesting cycles and report them
  without hanging.
- **FR-011**: System MUST pick up config file changes without a restart and re-validate
  them.
- **FR-012**: The UI MUST NOT provide any means to edit layout, appearance, composition, or
  plugin settings. Tracking and untracking items (FR-032) is data entry and is the only
  input the UI accepts.
- **FR-013**: System MUST publish the config schema and document it for operators.

**Plugins**

- **FR-014**: System MUST discover plugins from an operator-specified plugin location.
- **FR-015**: Each plugin MUST provide a manifest declaring its identifier, version, target
  plugin-API version, settings schema, capabilities, required environment variables,
  refresh behaviour, and (if applicable) its maximum batch size.
- **FR-016**: System MUST refuse plugins with an incomplete manifest, an unsupported API
  version, a duplicate identifier, or a mutating capability, and MUST report the reason.
- **FR-017**: The plugin API MUST carry its own semantic version, separate from the
  application version.
- **FR-018**: A plugin failure (error or timeout) MUST affect only that plugin's widgets,
  which show an error or timeout state.
- **FR-019**: Where config refers to a plugin that is missing or out of range, the widget
  slot MUST show a placeholder naming the plugin and the required version.
- **FR-020**: Built-in plugins, including the reference plugin, MUST use only the public
  plugin API.
- **FR-021**: Plugins MUST NOT be able to access the host's or other plugins' state or
  storage except through the documented API.

**Refresh & fetching**

- **FR-022**: System MUST run a single shared, server-side refresh cycle on a configurable
  interval, and push results to every connected viewer. When a viewer opens a dashboard,
  widgets already covered by the cycle show the latest results immediately. Widgets that
  weren't covered yet are fetched right away in one batched fetch per plugin, then join the
  shared cycle.
- **FR-023**: In each refresh cycle, the system MUST collect the data needs of the widgets
  visible to at least one connected viewer only (none when no viewer is connected), remove
  duplicate references, and hand each plugin exactly one batched fetch per source instance
  it is configured against. If the plugin declares a maximum batch size, the fetch is split
  into the fewest chunks that respect it.
- **FR-024**: A batched fetch MUST support partial results, so that a failure for some
  references affects only the widgets that need them.
- **FR-025**: System MUST cache fetched results for a short, configurable window
  (default 30 seconds; 0 disables the cache) to avoid repeated requests.
- **FR-026**: System MUST NOT run overlapping refresh cycles for the same plugin.
- **FR-027**: Widgets whose data is older than their plugin's refresh interval, because the
  latest fetch failed, MUST show a stale-data state with the time of the last successful
  fetch.

**Storage**

- **FR-028**: System MUST persist item references (the identifiers needed to find an item
  again in its source), links between references (including across plugins), and
  per-plugin private state.
- **FR-029**: System MUST NOT persist item content or status, configuration, or credentials.
- **FR-030**: Stored data MUST survive restarts. Store schema changes MUST be applied
  automatically at startup through versioned migrations that keep existing data.
- **FR-031**: System MUST refuse to start, without modifying the store, when the store is
  corrupt or was written by a newer, incompatible version.
- **FR-032**: Operators MUST be able to add item references through a "track item" action on
  widgets whose plugin supports tracking, and remove them through an "untrack" action. The
  owning plugin validates the identifier before it is stored. Each widget instance has its
  own tracked list and displays only that list. Duplicates within one widget's list MUST NOT
  be stored. The same item MAY be tracked in several widgets and is still fetched only once
  per refresh cycle. When a successfully loaded config no longer contains a widget
  identifier, that widget's references and their links MUST be deleted and the deletion
  logged. References MUST NOT be deleted for widgets in sections that failed validation.
  This is data entry, not configuration, so it does not conflict with FR-012.

**Secrets**

- **FR-033**: System MUST read secrets only from process environment variables or an
  operator-specified env file. Process environment variables take precedence.
- **FR-034**: Config MUST refer to secrets by variable name only. Literal values in
  secret-typed settings MUST be rejected.
- **FR-035**: Secrets MUST stay server-side, and MUST NOT be written to any file, the
  store, logs, or browser-visible output. Secret values MUST be redacted from errors and
  logs.
- **FR-036**: A missing required environment variable MUST be reported by plugin and
  variable name.

**Presentation**

- **FR-037**: The UI MUST be styled only through host-provided design tokens (color,
  typography, spacing, radius, motion). Config can select and override tokens. Plugin
  widgets MUST inherit tokens and MUST NOT apply global styles.
- **FR-038**: System MUST provide at least a light theme and a dark theme.
- **FR-039**: The UI MUST show only what the config defines, with minimal chrome. Controls
  MUST appear only on hover or focus.
- **FR-040**: The UI MUST be usable from 360px to 3840px viewport widths without horizontal
  scrolling, and MUST meet WCAG 2.2 AA (contrast, keyboard access, visible focus).
- **FR-041**: System MUST provide default loading, empty, error, and stale-data
  presentations that widgets use unless they provide their own.

**Access**

- **FR-042**: System MUST NOT include built-in authentication. Access control is the
  deployment's job (a trusted network or an authenticating reverse proxy), and the operator
  documentation MUST state this.

**Reference plugin**

- **FR-043**: System MUST ship a minimal reference plugin that uses a simulated source
  (no external system). The plugin MUST support batched lookup, report the number of
  source requests it made, store references, links, and state, include a secret-typed
  setting, provide a widget, and be able to simulate failure, slowness, and partial results
  for testing.
- **FR-044**: Automated contract tests MUST run against the reference plugin and a
  reference config. They cover manifest validation, version negotiation, batched and
  de-duplicated fetching, partial failure, isolation, storage, and secret handling.
- **FR-045**: System MUST ship plugin-author documentation for the plugin contract, with
  the reference plugin as the worked example.

**Operations**

- **FR-046**: System MUST write structured logs to standard output covering: plugin load and
  refusal results, configuration errors, each refresh cycle (plugins fetched, source
  requests made, duration, failures), and store migrations. Secret values MUST be redacted
  (FR-035).
- **FR-047**: System MUST expose a health-check endpoint that reports one of three states.
  Unhealthy: the store is unusable. Degraded: there are config errors or refused or failing
  plugins. Healthy: everything else. It also gives a short machine-readable reason.

**Mock mode**

- **FR-048**: System MUST provide a mock mode, switched on for the whole instance by a startup
  option or environment variable. In mock mode every plugin serves data from its own mock
  source instead of the real source system: no source-system requests are made and no
  secrets are required. Tracking, batching, de-duplication, caching, storage, and widget
  states behave exactly as in normal mode.
- **FR-049**: Every plugin that has a source MUST ship a mock source that can return realistic
  data for any valid reference, and can simulate not-found, errors, slowness, and partial batch
  results. A plugin with a source but no mock source MUST be refused. Composite plugins, which have
  no source (introduced in 002, plugin API 1.1), are exempt.
- **FR-050**: The UI MUST show a clear, persistent indicator while mock mode is active.

### Key Entities

- **Configuration Set**: all config files loaded from the configuration location, joined by
  includes. It has a format version and is the only source of truth for configuration.
- **Dashboard**: a named page with a layout, a theme choice, design-token overrides, and
  placed widgets and block uses.
- **Template Block**: a named, reusable arrangement of widgets and nested blocks, with
  declared overridable parameters.
- **Widget Instance**: a placement of a plugin's widget on a dashboard or in a block, with
  a stable identifier, a grid position (column, row), a size (width, height in grid units),
  and plugin settings. It owns its own tracked list. The identifier is set explicitly in
  config and is unique within its dashboard or block. A widget placed through a block use is
  identified by its path (dashboard → block use → widget), so each use of a block has its
  own tracked lists.
- **Plugin**: an installed extension described by its manifest (identifier, version, target
  API version, settings schema, capabilities, required environment variables, refresh
  behaviour, maximum batch size).
- **Item Reference**: the identifiers that locate one tracked item in one plugin's source
  system, tracked by one widget instance. It is unique within that widget instance and holds
  no item content or status. (Persisted.)
- **Reference Link**: a relationship between two item references, possibly owned by
  different plugins. (Persisted.)
- **Plugin State**: private key–value data belonging to one plugin's namespace.
  (Persisted.)
- **Refresh Cycle**: one server-side pass, shared by all viewers, that gathers the data needs
  of the widgets visible to any connected viewer, removes duplicates, dispatches batched
  fetches, and pushes results to every viewer. (Not persisted.)
- **Secret Reference**: the name of an environment variable used in place of a secret
  value in config.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator new to Opsdash can get a working dashboard from the example
  config in under 10 minutes, using only the documentation.
- **SC-002**: Every error in the invalid-config test set (at least 20 distinct mistakes)
  names the file, the location, and the problem. An operator can fix each one on the first
  try, without reading source code.
- **SC-003**: With a dashboard of 20 widgets from one plugin against one source instance, a
  refresh cycle sends exactly one batched source request (or the fewest the declared batch
  size allows), and each distinct reference is requested once.
- **SC-004**: The number of source requests per refresh cycle is the same with 1 viewer
  and with 10 viewers of the same dashboards.
- **SC-005**: When one plugin fails or hangs, 100% of the other widgets keep updating on
  schedule.
- **SC-006**: A dashboard with 20 widgets is fully displayed (all widgets showing data or
  their final state) within 2 seconds of opening, when using the reference plugin.
- **SC-007**: A config file change is visible on an open dashboard within 3 seconds, with
  no restart.
- **SC-008**: After 100 restarts in a test run, 100% of stored references, links, and
  plugin state are intact.
- **SC-009**: A search of config files, the store, logs, and all browser-visible output
  finds zero occurrences of any secret value.
- **SC-010**: Every screen passes WCAG 2.2 AA checks in both themes, and has no horizontal
  scrolling at widths from 360px to 3840px.
- **SC-011**: A developer can build and load a new plugin by copying the reference plugin,
  using only the plugin documentation, in under 1 hour.

## Assumptions

- Opsdash runs as a single deployable. The only store it needs is one embedded, file-based
  database (SQLite per the constitution). No external services are required.
- The operator has access to the machine or container where Opsdash runs, and edits config
  files there, usually under version control.
- Plugins are installed by placing them in a plugin location on disk. Plugin marketplaces,
  remote installation, and sandboxing plugin code from the host process are out of scope.
  Plugins are trusted code.
- Mutating plugin capabilities (Constitution Principle III) are out of scope for this
  feature. Plugins that declare them are refused. Confirmation dialogs and the action log
  come with the first feature that needs them.
- Mock mode is meant for development, demos, and automated tests. It uses the same store
  file format. Operators are expected to point mock mode at a separate store file.
- Anyone who can reach Opsdash can view every dashboard and track or untrack items. There
  are no users, roles, or login.
- Links between references are created by plugins through the host storage API. Linking
  items by hand in the UI is out of scope for this feature.
- There are no source-system plugins in this feature. The reference plugin talks only to a
  simulated source.
- The default refresh interval is 60 seconds, and the default cache window is 30 seconds.
  Both can be changed in config.
- Config format migrations only need to cover format versions released after this
  feature. This feature defines format version 1.
- Performance targets assume a typical developer laptop or a small server, with a single
  operator or a small team viewing the dashboard at the same time.
- Tech stack, library choices, and the bundle-size and startup budget are decided in the
  implementation plan.

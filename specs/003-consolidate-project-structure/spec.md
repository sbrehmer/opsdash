# Feature Specification: Consolidate Project Structure

**Feature Branch**: `003-consolidate-project-structure`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "The current project setup is a nightmare, ui, host, plugins all separated with independent dependency management and package.json, it adds complexity. I've also encountered some build issues on another machine with pnpm and vite missing. The project needs a refactor so that the individual components are organized better."

## Context

Opsdash is split into ten separately managed units today: the project root, four shared components
(host server, web UI, plugin SDK, shared delivery cells) and five built-in plugins (delivery, GitHub,
Jenkins, Jira, reference). Each unit declares its own dependencies, versions and build steps. The same
third-party libraries are declared in up to eight places. Setting up on a new machine failed because
tools that the project needs were not available: one had to be installed globally in advance, and the
other was declared only inside individual units, not at the project level.

The split itself is also a problem. The host server and the web UI are one product, served together as
a single deployable (constitution Principle IV). Keeping them as separate packages adds boundaries,
configuration and indirection that bring no benefit.

This feature changes how the project is organized, installed and built. It does not change what Opsdash
does for dashboard users.

**Update 2026-09-28**: The user asked to drop the host/web package split as well and move to a
conventional single-application layout (User Story 3, FR-015 to FR-017).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set up and run on a fresh machine (Priority: P1)

A contributor clones the repository on a machine that has only the project's tool-version manager
installed. That manager installs the pinned language runtime and the pinned install tool. The
contributor then runs the documented install and build steps and starts Opsdash in mock mode. Every
other tool the project needs is installed by the project's install step.

**Why this priority**: This is the failure the user actually hit. If a new machine can't build the
project, nobody new can contribute and no deployment can be reproduced.

**Independent Test**: On a clean machine or container with only the tool-version manager, clone the
repository, follow the README quick start as written, and confirm the mock dashboard loads in a browser.

**Acceptance Scenarios**:

1. **Given** a clean machine with only the tool-version manager, **When** the contributor runs the
   documented setup and install steps, **Then** the pinned runtime and install tool are provisioned
   and the install finishes without asking them to install any other tool globally.
2. **Given** a completed install, **When** the contributor runs the single documented build step,
   **Then** the web UI and every built-in plugin are built and no "tool not found" error appears.
3. **Given** a completed build, **When** the contributor starts mock mode, **Then** the dashboard is
   served with the same sample data as before the refactor.
4. **Given** a machine with the wrong runtime or install-tool version (for example, one not set up
   through the tool-version manager), **When** the contributor runs the install step,
   **Then** they get a clear message naming the required version, instead of a failure later in the
   build.

---

### User Story 2 - Manage dependencies in one place (Priority: P2)

A maintainer adds, upgrades or removes a third-party library for the host, the web UI or any built-in
plugin by changing a single dependency declaration for the whole project. Every component then uses
the same version of that library.

**Why this priority**: Declaring the same library many times is the main source of the complexity the
user describes. It lets versions drift apart and makes upgrades error-prone.

**Independent Test**: Upgrade a library that the host, the web UI and the plugins share. Confirm that
exactly one declaration changed and that every component resolves to the new version.

**Acceptance Scenarios**:

1. **Given** the refactored project, **When** a maintainer lists its dependency declarations, **Then**
   there is exactly one for the whole project (built-in plugins included).
2. **Given** a library used by several components, **When** the maintainer upgrades it, **Then** they
   edit one declaration and all components use the new version.
3. **Given** the refactored project, **When** the full check suite (tests, type checks, lint) runs,
   **Then** it passes from the project root with one command per check.

---

### User Story 3 - One application with a conventional layout (Priority: P2)

A contributor opens the repository and finds one Opsdash application, not separate "host" and "web"
packages. Inside it, code is grouped by where it runs: server-side code (HTTP, config loading, storage,
plugin lifecycle, refresh), browser-side code (dashboard rendering, layout grid, theming, widget
frames) and code shared by both (shared types and contracts). The plugin SDK and the built-in plugins
sit beside the application at the top level, so the boundary between the host and plugins stays
visible. Adding a new built-in plugin means adding its source folder and its plugin manifest. It does
not mean creating a new dependency declaration, build configuration or type-check configuration.

**Why this priority**: The user named the host/web split as a problem in its own right. A
conventional layout is what new contributors expect, and it removes the separate configuration each
package needs. It ranks after the fresh-machine setup, which blocks all work.

**Independent Test**: A contributor unfamiliar with the project finds the code for a given concern
(for example "where config files are validated" or "where the dashboard grid is drawn") from the
README layout section alone. Separately, add a minimal new built-in plugin by copying the reference
plugin, and confirm it builds, loads and passes its tests without any per-plugin dependency or build
files.

**Acceptance Scenarios**:

1. **Given** the refactored layout, **When** a contributor looks at the top level, **Then** they see
   one application, the plugin SDK, the built-in plugins, tests, config/examples and scripts. There
   are no separate host and web packages.
2. **Given** the application, **When** a contributor looks inside it, **Then** server-only,
   browser-only and shared code are in clearly named, separate areas.
3. **Given** browser-side code, **When** it tries to import server-only code, **Then** the type check
   or build fails with a clear error, so server code and secrets can never end up in the browser
   bundle.
4. **Given** the refactored layout, **When** a contributor reads the README's project layout section,
   **Then** each top-level area and each area inside the application is listed with its purpose.
5. **Given** a new plugin folder containing only source code and a plugin manifest, **When** the
   project build runs, **Then** the new plugin is built and discovered by the host like any other
   built-in plugin.

---

### User Story 4 - Third-party plugins keep working (Priority: P3)

A plugin author outside this repository builds a plugin against the published plugin SDK and drops the
built plugin into the plugins directory. It still loads exactly as before.

**Why this priority**: The constitution requires built-in and third-party plugins to use the same
public API. Consolidating the built-in plugins must not take away the path for external ones.

**Independent Test**: Take the reference plugin, build it outside the main project using only the
plugin SDK, place the output in a plugins directory, and confirm the host loads it.

**Acceptance Scenarios**:

1. **Given** a plugin built outside the project against the plugin SDK, **When** it is placed in the
   plugins directory, **Then** the host loads it and its widgets render.
2. **Given** the plugin SDK, **When** a plugin author looks for its public entry points, **Then** they
   are the same as before the refactor, or a migration note documents every change.

---

### Edge Cases

- A contributor still has leftover per-component install folders or build output from the old layout:
  the install and build steps either work or say which stale folders to remove.
- A deployment or script points at old paths (for example the plugins directory or the built web UI):
  the documented start commands and the default config keep working, and any path that changed is
  listed in the migration notes.
- Two built-in plugins would need different versions of the same library: the conflict is reported at
  install time, and the maintainer has to settle on one version.
- The native database driver has to compile during install: the install step still allows it, and a
  failure names the missing system prerequisite.
- The "is it built?" check before start: it detects missing build output under the new layout and
  tells the user the single build command to run.
- Watch/dev mode: changes to host, web UI and plugin sources are still picked up without a manual
  rebuild of every component.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project MUST have exactly one dependency declaration covering the host, the web UI,
  the plugin SDK, the shared UI pieces and all built-in plugins.
- **FR-002**: Each third-party library MUST be declared once and resolve to a single version across
  all components.
- **FR-003**: The only prerequisite a contributor installs by hand MUST be the project's tool-version
  manager. It MUST provision both the pinned language runtime and the pinned install tool from the
  project's tool-version file. Every other tool needed to install, build, test or run MUST be installed
  by the project's install step.
- **FR-004**: The project MUST pin the runtime version and the install tool version, and MUST stop
  with a clear message when an incompatible version is used.
- **FR-005**: One build command at the project root MUST produce the web UI and every built-in plugin.
- **FR-006**: Tests, type checks, lint, size checks and end-to-end tests MUST each run from the
  project root with a single command, and MUST cover all components.
- **FR-007**: The layout MUST give each component (host server, web UI, plugin SDK, shared UI
  pieces, built-in plugins) a clearly named, predictable location, and the README MUST document it.
- **FR-008**: Each built-in plugin MUST still declare its plugin metadata (identifier, version, target
  API version, configuration schema, capabilities, required environment variables, refresh behaviour).
  It MUST NOT need its own dependency declaration or build configuration.
- **FR-009**: Built-in plugins MUST still use only the public plugin API, with no new shortcuts into
  host internals (constitution Principle I).
- **FR-010**: Plugins built outside the project against the plugin SDK MUST continue to load without
  changes.
- **FR-011**: All current start, database and config commands (mock, development and production start;
  database setup, status and reset; config check) MUST keep working, with the same behaviour and
  options.
- **FR-012**: Opsdash's runtime behaviour MUST be unchanged: dashboards, config format, database
  schema, API responses and plugin API version.
- **FR-013**: Dev/watch mode MUST rebuild or reload changed host, web UI and plugin sources from a
  single command.
- **FR-014**: Migration notes MUST list every changed path or command, plus the one-time cleanup that
  existing checkouts need.
- **FR-015**: The host server and the web UI MUST be merged into one application. Inside it, code
  MUST be grouped into server-only, browser-only and shared areas, following a common convention for
  full-stack web applications.
- **FR-016**: The project MUST enforce the boundary between browser and server code automatically
  (type check or build), so that server-only code, including secret handling, cannot be imported into
  the browser bundle (constitution Principle III).
- **FR-017**: The plugin SDK and the built-in plugins MUST remain outside the application's internal
  code. Plugin code MUST reach the host only through the plugin SDK. UI pieces shared by several
  plugins (today's "delivery cells") MUST live on the plugin side of that boundary, not inside the
  application.

### Key Entities

- **Application**: The single Opsdash product (formerly "host" and "web"). It is divided into server,
  browser and shared areas.
- **Component**: A top-level part of the project: the application, the plugin SDK, plugin-shared UI
  pieces, or a built-in plugin. It has a location in the layout and a role. It no longer has its own
  dependency declaration.
- **Plugin manifest**: A built-in plugin's declared metadata, as required by the constitution. It is
  kept separate from dependency management.
- **Project dependency declaration**: The single list of third-party libraries and tools, with
  pinned versions, used by every component.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean machine with only the tool-version manager, a contributor gets from clone to
  a running mock dashboard in at most 4 documented commands (provision tools, install, build, start)
  and under 10 minutes, with no extra tools installed by hand.
- **SC-002**: The number of dependency declarations drops from 10 to 1.
- **SC-003**: Every third-party library is declared exactly once (today some are declared up to 8
  times).
- **SC-004**: 100% of the existing automated tests (unit, contract, end-to-end) pass after the
  refactor, with no change to what they assert about runtime behaviour.
- **SC-005**: A new built-in plugin can be added by creating only source files and a plugin manifest:
  0 new dependency, build or type-check configuration files.
- **SC-006**: A full clean build takes no more than 10% longer than before, and the existing
  bundle-size and cold-start budgets are still met.
- **SC-007**: The reference plugin, built outside the project against the plugin SDK, loads in the
  host with no changes to its source.
- **SC-008**: The number of top-level code units drops from 9 (4 packages and 5 plugins) to the
  application, the plugin SDK and the plugins folder. A new contributor finds the code for 5 named
  concerns from the README layout section in under 5 minutes.

## Assumptions

- "Best-practice layout" means the conventional full-stack layout for a single web application: one
  source tree divided by where code runs (server, browser, shared), with tests next to the code or in
  a top-level tests area. The exact folder names are a planning decision.
- Decided 2026-09-28: the application is split into top-level server, browser and shared areas. Two
  alternatives were rejected: one flat source folder with no boundary (it would break FR-016 and
  constitution Principle III), and a layout organized by feature with the side marked in each file
  name.
- Where the plugin-shared UI pieces go (inside the plugin SDK's browser helpers, or as their own
  plugin-side folder) is a planning decision, within the limits of FR-017.
- The five built-in plugins and the shared delivery cells move into the single project. They stay
  separate folders, but none keeps its own dependency declaration.
- The plugin SDK stays a clearly separated component, because third-party authors depend on it. It
  may keep a minimal description of its own if needed for external use, but the in-repo build does
  not depend on that.
- Decided 2026-09-28: the current install tool stays. It is pinned next to the runtime in the
  project's tool-version file (`mise.toml`), so the tool-version manager provisions both. Contributors
  who don't use the manager can still install the two pinned versions by hand.
- The currently pinned runtime version and its declared minimum stay as they are.
- The native database driver still needs a system compiler when no prebuilt binary is available. This
  is documented and not removed.
- The on-disk plugin discovery format (a built manifest in each plugin's output folder) stays the
  same, so existing deployments and third-party plugins are unaffected.
- Runtime features, the config format, the database schema and the plugin API version are out of
  scope and must not change.

# Changelog

All notable changes to the Tulcase VS Code extension are documented here.
This project follows [Semantic Versioning](https://semver.org/).

---

## [1.8.3] - 2026-06-13

### Summary
Workspace-local tag filter for the Pipelines view; confirmed GitLab tokens are never synced.

### Added
- **Pipeline tag filter (per workspace)**: the Pipelines view shows toggleable tag chips built from your scopes' tags. Selecting tags narrows the view to matching scopes (OR semantics; empty = all), with a **Clear** action. The selection is stored in VS Code `workspaceState`, so it is **per workspace, survives restarts, and is never written to the data directory** — every workspace filters the *same* shared scope list independently, and the filter is never carried by Git Sync.
- Scopes excluded by the tag filter are **pruned from the store and no longer polled**, so filtered-out pipelines stop updating until re-included.

### Security
- Verified that GitLab Personal Access Tokens (both Pipe and Git Sync) are stored only in VS Code's encrypted `SecretStorage` and never written to any file under the synced data directory; the sync remote stores a credential-free URL. No token is ever pushed to the sync repository.

---

## [1.8.2] - 2026-06-13

### Summary
Scripts: a full reusable-script tool alongside Commands, in a new dedicated activity-bar tab.

### Added
- **Commands & Scripts activity-bar container**: the Commands view is relocated out of the main Tulcase sidebar into its own tab, now sharing it with the new Scripts view.
- **Scripts view**: organize reusable shell scripts in recursive folders with tags and `<$name$>` placeholders — the same model as Commands. Each script is backed by a **real `.sh` file on disk** (`scripts_db/files/<id>.sh`) that you edit in a normal editor tab (shell-script highlighting, no-prompt auto-save), just like Notes.
- **Run scripts in the terminal**: the ▶ action (and the *Run Script* palette picker) resolves placeholders, then runs the script via a configurable interpreter (`tulcase.scripts.interpreter`, default `bash`). Scripts with placeholders run from a resolved temp copy so the saved file keeps its tokens.
- **Run confirmation with trust marker**: running a script asks for confirmation unless its body contains a `# tulcase: no-confirm` comment line.
- **Palette commands**: *Add Script*, *Open Script*, *Run Script* (the open/run pickers are folder-grouped and searchable).
- **AI tools**: `tulcase_list_scripts`, `tulcase_read_script`, `tulcase_add_script`, `tulcase_edit_script`, `tulcase_delete_script`, `tulcase_manage_script_folder`, `tulcase_move_script_entry` — agents can fully manage scripts, folders, and `.sh` bodies.
- Scripts (metadata + every `.sh` file) are carried by database export/import and reconciled by Git Sync's semantic three-way merge.

---

## [1.8.1] - 2026-06-12

### Summary
Patch release: make Git Sync resilient for common multi-workspace edits.

### Fixed
- Git Sync now handles common multi-workspace divergence by fetching, merging, semantically auto-merging Tulcase JSON stores, retrying push races, and opening a resolver panel for remaining conflicts instead of requiring a reset.

## [1.8.0] - 2026-06-12

### Summary
Tulcase Pipe: the standalone GitLab-pipelines extension is now a fully integrated Tulcase feature — with pipeline actions, form-based scopes, follow notifications, and a refined job-log experience. See `docs/pipe.md`.

### Added
- **Pipelines view** (new activity bar container): scopes → pipelines → stages → jobs tree with nested downstream pipelines, persisted filters (text + status), per-scope counts, tag chips, and empty-state actions.
- **Pipeline actions** from the view and the command palette: guided *Run Pipeline* flow (project picker with GitLab search, live branch picker, CI/CD variables, file variables, and `spec:inputs`), retry/cancel pipeline, play/retry/cancel job, download artifacts, copy URLs.
- **Pipe Scopes view** (own activity bar container): full visual scope editor — project search, status chips, log-rule chips, Tulcase tag picker, enable switch, follow bell, duplicate/reorder/delete. Scopes are stored per-database (`pipe_db/scopes.json`), sync via Git Sync, and validate against a shipped JSON schema when edited as raw JSON.
- **Follow**: mark a scope with the bell and get VS Code notifications when its pipelines finish (error on failed, warning on canceled, info on passed) — including in the background while the views are closed.
- **Job logs in the editor**: plain click opens a job log in a single reusable "switch" tab (click another job to swap in place); Ctrl/Cmd+click pins an extra tab. Logs are read-only-in-session, stream live with ANSI colors as decorations, auto-follow the tail, and clean up their polling when closed. Editor-title save button included.
- **Log rules**: pre-shipped regex filters (strip timestamps, GitLab section markers, runner noise, progress bars, debug lines, redact secrets, shorten SHAs) plus custom rules with a live regex preview editor. Custom rules can override built-ins; deleting the override restores the original.
- **Status bar**: latest pipeline status for the current Git branch (remote-aware), click to open in GitLab.
- **AI tools**: `tulcase_pipe_list_scopes`, `tulcase_pipe_status`, `tulcase_pipe_job_log`, and `tulcase_pipe_trigger_pipeline` (with confirmation).
- One-command migration from the standalone extension: *Pipe: Import Scopes from Tulcase Pipe Extension* (reads `scopes.jsonc`).
- Settings under `tulcase.pipe.*` (GitLab URL, poll intervals, concurrency, notifications, status bar).

### Fixed
- Tag rename/delete now propagates into saved commands again (the propagation helper still read the pre-v1 command store format and skipped current-format files).

### Changed
- Database seeding now also creates `pipe_db/scopes.json`; existing databases are seeded on activation (idempotent).
- Removed the dead pre-webview `command-tree.provider.ts`.

## [1.7.4] - 2026-06-04

### Summary
Patch release: add Tulcase AI tools for chat agents and complete folder-aware management for notes, links, commands, todos, and tags.

### Added
- `contributes.languageModelTools` registrations in `package.json` so VS Code agents can call Tulcase tools directly.
- `src/chat/tools.ts` with AI tools for listing, creating, updating, and deleting TODOs.
- AI tools for listing, reading, creating, and editing notes, links, commands, and tags.
- Dedicated AI tools for creating, renaming, deleting, and moving note folders, link folders, and command folders.

### Changed
- AI edits now validate folder targets for notes and commands instead of allowing invalid folder IDs.
- Folder operations exposed to agents now follow the same re-parenting rules as the existing Tulcase webviews.

## [1.4.1] – 2026-04-20

### Summary
Patch release: fix the records calendar width regression and add branch-aware automatic version sync.

### Fixed
- `src/views/record-calendar.scss` — the Records view now keeps a single stacked layout so the calendar always gets the full width and the Sunday column is no longer clipped in the panel.

### Added
- `scripts/auto-version.mjs` — computes branch-aware versions for `main`, `develop`, and feature branches.
- `.github/workflows/version-sync.yml` — commits automatic version bumps on push with `[skip ci]`.

### Changed
- `package.json` / `package-lock.json` — bumped the current develop line to `1.4.1`.
- `.github/workflows/release.yml` — release publishing now uses the already-synced version by default and keeps manual major bumps separate.

## [1.4.0] – 2026-03-30

### Summary
Feature release: **command placeholders**. Commands can now contain `<$name$>` tokens that are resolved interactively when copying or sending to the terminal.

### Added
- **Placeholder syntax** — use `<$name$>` inside any command text to mark dynamic segments (e.g. `git checkout <$branch$>`).
- **Default-value entry** — when adding or editing a command, each detected placeholder prompts for an optional comma-separated list of default values.
- **Interactive resolution** — on Copy or Send-to-Terminal, each placeholder shows a QuickPick (if defaults exist) or an InputBox (free text). A "Custom…" option is always available.
- **Edit → Placeholders** — a new edit-menu entry lets you update default values for existing placeholders.
- **Stale-key pruning** — when the command text is edited, placeholder metadata for removed tokens is cleaned up automatically.
- **Visual indicator** — commands with placeholders show a small badge in the webview listing.
- `src/utils/placeholder.ts` — pure parsing/replacement utilities (`parsePlaceholders`, `applyPlaceholders`, `prunePlaceholders`).
- `src/utils/placeholder-resolve.ts` — VS Code–dependent `resolveCommand` helper.
- `docs/command-placeholders-plan.md` — feature plan document.
- 17 new unit tests for placeholder parsing, application, and pruning.

### Changed
- `CommandItem` model gains an optional `placeholders` field (`Record<string, PlaceholderDef>`).
- `command-list.view.ts` — add-command, copy, terminal, and edit flows now support placeholder resolution.
- `command-commands.ts` — palette copy & insert commands resolve placeholders before acting.
- `command-list.html` / `command-list.scss` — placeholder badge indicator in webview UI.

---

## [1.3.12] – 2026-03-30

### Summary
Feature release: add upstream CI and automated VSIX release workflows with automatic semantic version bumping.

### Added
- `.github/workflows/ci.yml` — GitHub Actions CI pipeline with dedicated test and build jobs for pushes and pull requests.
- `.github/workflows/release.yml` — GitHub-hosted release pipeline with test, build, and release stages.
- `docs/releasing.md` — documentation for the automated GitHub release flow.

### Changed
- `README.md` — documents the new release automation entry points.
- `docs/README.md` — links to release-process documentation.
- `package.json` and `package-lock.json` — synchronized to version `1.3.12`.

---

## [1.3.11] – 2026-03-30

### Summary
Hotfix release: rework the documentation so it works directly in the GitHub repository without GitHub Pages.

### Changed
- `README.md` — updated the docs section to point at a plain repository docs folder instead of a Pages site.
- `docs/` — converted all documentation pages to plain GitHub markdown by removing Jekyll frontmatter.
- `docs/README.md` — added a repository-native documentation landing page for GitHub browsing.

### Removed
- `docs/_config.yml` — removed the Jekyll configuration because Pages is not enabled.
- `.github/workflows/pages.yml` — removed the GitHub Pages deployment workflow.

---

## [1.3.10] – 2026-03-30

### Summary
Patch release: add a proper GitHub-facing README and a GitHub Pages-ready documentation site for Tulcase.

### Added
- `README.md` — repository landing page covering product purpose, feature overview, setup, and doc links.
- `docs/index.md` — documentation home page for GitHub Pages.
- `docs/getting-started.md` — practical setup and first-use guidance.
- `docs/workflows-and-hacks.md` — productivity patterns and usage tips for developers.
- `docs/architecture.md` — high-level architecture and storage notes.
- `docs/roadmap.md` — focused product direction and future ideas.
- `docs/_config.yml` — Jekyll configuration for a GitHub Pages publish target.
- `.github/workflows/pages.yml` — automated Pages deployment workflow for documentation updates on `main`.

### Changed
- `package.json` — bumped the extension version to `1.3.10`.

---

## [1.3.9] – 2026-03-30

### Summary
Patch release: restore the canonical TODO row layout and remove the stale Notes title action.

### Fixed
- `src/views/todo-list.html` — TODO items now render their content and action buttons inside the shared `.tree-item-row` container again, so edit/postpone/done actions stay right-aligned like the other list views.
- `src/views/todo-list.scss` — overrides the shared row cursor for TODO items so the row does not imply click-to-open behavior.

### Changed
- `package.json` — removed the obsolete `tulcase.note.add` title-bar action from the Notes view and bumped the extension version to `1.3.9`.
- `src/commands/list-commands.ts` — updated the command registration comment to match the current UI.

---

## [1.3.0] – 2026-03-27

### Summary
Feature release: **Directory-based Database Management**.  Each database is now
a named sub-folder under `{rootDir}/data/{name}/`, and switching databases simply
changes which folder the extension reads from — no copying or snapshotting
required.  Four new palette commands let users export, import, switch, and sync
databases across workspaces via the clipboard.

### Added
- `src/config.ts` — new fields `rootDir`, `activeDb` on `TulcaseSettings`;
  `switchSettingsTo()` mutates settings in-place; `ensureInitialized()` handles
  first-run setup and legacy flat-layout migration; `ensureDatabase()` seeds
  empty database directories; `readActiveDb()` / `writeActiveDb()` persist the
  active database name.
- `src/data/db-manager.ts` — `listDatabases`, `createDatabase`,
  `exportDatabase`, `importDatabase` for the new directory-based layout.
- `src/commands/db-commands.ts` — four palette commands:
  - **Export Database** (`tulcase.db.export`) — pick any database → clipboard.
  - **Import Database** (`tulcase.db.import`) — clipboard → new database,
    with optional immediate switch.
  - **Switch Database** (`tulcase.db.switch`) — pick or create a database and
    switch to it instantly (no confirmation needed).
  - **Update Database** (`tulcase.db.update`) — clipboard → overwrite the
    database with the same name (cross-workspace sync).
- `src/test/db-manager.test.ts` — 16 unit tests covering db-manager operations,
  config init, migration, buildSettings, switchSettingsTo, and round-trips.

### Changed
- `src/extension.ts` — calls `ensureInitialized()` on activation; wires
  `registerDbCommands`.
- `package.json` — declared 4 new commands with icons; bumped to `1.3.0`.
- Data directory layout changed from flat (`{rootDir}/todo_db/…`) to
  `{rootDir}/data/{dbName}/todo_db/…`.  A "default" database is created
  automatically on first launch, and legacy data is migrated into it.

---

## [1.2.1] – 2026-03-27

### Summary
Remove the manual focus-command suppression logic from the manifest — reverted
the explicit focus command declarations so VS Code's defaults are used again.

### Changed
- Reverted explicit `tulcase.*.focus` `contributes.commands` declarations and
  `commandPalette` suppression entries from `package.json`.

### Notes
- This branch implements the revert and was merged to `develop` as `v1.2.1`.

## [1.2.0] – 2026-03-27

### Summary
Adds the **Insert Command in Terminal** command and definitively removes all six
view-focus entries from the command palette.

### Added
- `tulcase.command.insert` — searchable tree-picker selects a saved command and
  inserts its text into the active (or a new) integrated terminal without
  executing it, so the user can review before pressing Enter.

### Fixed
- All six VS Code auto-generated view-focus commands (`tulcase.todos.focus`,
  `tulcase.commands.focus`, `tulcase.lists.focus`, `tulcase.links.focus`,
  `tulcase.tags.focus`, `tulcase.records.focus`) are now explicitly declared in
  `contributes.commands` and suppressed from the palette via
  `commandPalette when:false`. Previously the `when:false` filter only applied
  to commands listed in `contributes.commands`; auto-generated focus commands
  escaped that filter.
- Removed residual `executeCommand('xxx.focus')` panel-focus side-effects that
  were still present in the add-command and add-note handlers (cleaned up in
  v1.1.0 but verified clean here).

---

## [1.1.0] – 2026-03-26

### Summary
Feature release: overhaul of the VS Code command palette integration. Only meaningful, user-facing operations are now exposed as palette commands. A reusable tree-picker component was introduced to enable searchable, folder-grouped selection for commands, notes, and links.

### Added
- `src/data/tree-picker.ts` — reusable `showTreePicker<T>()` function that renders a searchable VS Code QuickPick with items grouped under folder separator headers. Supports `matchOnDescription` so users can search by URL, command text, tag list, etc.
- `tulcase.command.copy` command — shows a tree-picker of all saved commands (grouped by folder); copies the selected command text to the clipboard.
- `tulcase.note.open` command — shows a tree-picker of all notes (grouped by folder); opens the selected note in the main editor as a Markdown document.
- `tulcase.link.open` command — shows a tree-picker of all bookmarks (grouped by folder tree path); opens the selected URL in the default browser.
- Public `addTodoFromPalette()`, `addCommandFromPalette()`, `addNoteFromPalette()` methods on view providers so palette commands can trigger add dialogs without duplicating logic.

### Changed
- Command palette now only shows 7 intentional commands: **Add Todo**, **Add Command**, **Copy Command**, **Add Tag**, **Open Note**, **Open Link**, **Log Time**.
- `tulcase.todo.quickAdd` (Ctrl+Shift+T) remains registered for its keybinding but is hidden from the palette.
- `tulcase.note.add`, `tulcase.link.add`, `tulcase.refresh`, and all tag context-menu commands are hidden from the palette via `commandPalette` menu entries (`when: false`).
- Removed `ctrl+shift+d` keybinding for the now-deleted `tulcase.openDashboard` stub.

### Removed
- `tulcase.todo.toggleShowDone` — was a no-op; done items collapse in the webview UI.
- `tulcase.command.runInTerminal`, `tulcase.command.edit`, `tulcase.command.delete` — webview-internal actions; not appropriate in the command palette.
- `tulcase.openDashboard` — placeholder stub removed entirely.

---

## [1.0.1] – 2026-03-26

### Summary
Internal refactoring release. Extracts a shared component library from duplicated view code. No user-facing changes.

### Changed
- Created `_shared.scss` — single source of truth for all common webview styles (variables, reset, layout, add-bar, search-bar, sections, tree-item classes, action buttons, empty states, adaptive container-query layout).
- Refactored all 4 feature SCSS files (`note-list`, `link-list`, `todo-list`, `command-list`) to `@use 'shared'` with only feature-specific overrides.
- Migrated all HTML templates from feature-prefixed classes (`note-*`, `link-*`, `todo-*`, `cmd-*`) to generic `tree-item-*` class names.
- Added `.layout > .controls-pane + .tree-pane` adaptive layout structure to Todos and Commands (previously only in Links and Notes).
- Created `BaseListViewProvider` abstract base class extracting shared `resolveWebviewView`, `refresh`, `_buildHtml`, and `getNonce`.
- Refactored all 4 `WebviewViewProvider` classes to extend `BaseListViewProvider`, eliminating ~120 lines of duplicated boilerplate.

---

## [1.0.0] – 2026-03-26

### Summary
First production release. The extension has been fully rebranded from **Arbeitsplatz** to **Tulcase** and now operates as a standalone extension with no legacy fallbacks.

### Added
- Tags view relocated to the bottom panel (left of Records) for better discoverability.
- `release-plan-v1.0.0.md` documenting the release checklist.

### Changed
- Extension renamed from `arbeitsplatz` / `Arbeitsplatz` to `tulcase` / `Tulcase` throughout all source files, configuration keys, view IDs, and documentation.
- Data directory now resolves exclusively under `tulcase` (Windows: `%APPDATA%/tulcase`, macOS: `~/Library/Application Support/tulcase`, Linux: `~/.local/share/tulcase`). No more legacy `arbeitsplatz` fallback.
- `package.json` view declarations updated: `tulcase.tags` moved from the activity-bar sidebar into the bottom panel, placed to the left of `tulcase.records`.

### Removed
- `migrateLegacyBaseDir()` function and all `arbeitsplatz` config-key fallbacks from `src/config.ts`.

---

## [0.7.0] – 2026-03-26

### Added
- **Links webview panel** — replaced the tree-data-provider with a rich
  WebviewViewProvider matching the visual style of TODOs, Commands, and Notes.
- **Adaptive layout** — the Links panel detects its container width via CSS
  container queries: in a sidebar it renders vertically (controls on top, tree
  below), in the bottom panel it renders horizontally (tree on the left,
  controls on the right).
- Recursive folder/link tree with collapsible sections, folder badges,
  and alphabetical sorting.
- Per-link action buttons on hover: **open in browser**, **copy URL**,
  **edit** (label / URL / tags), **delete**.
- Per-folder action buttons: **add link**, **add sub-folder**, **rename**,
  **delete**.
- Colour-coded tag badges on link items.
- Inline URL preview (truncated with tooltip).
- Full-text search across link labels, URLs, and tags with branch pruning
  (empty folders are hidden during search).
- Palette command `Tulcase: Add Link` (`tulcase.link.add`) with
  tag picker integration.
- 10 new unit tests for search/filter helpers (84 total).

### Changed
- `link-commands.ts` simplified to a palette-only shim — all CRUD is now
  handled inside `LinkListViewProvider`.
- `package.json` view declaration updated to `type: "webview"`.
- Old tree-based commands and context-menu entries removed.

### Removed
- `LinkTreeProvider` / `LinkTreeItem` classes (superseded by webview).

---

## [0.6.0] – 2026-03-26

### Added
- **Notes system** — The Lists feature has been completely reworked into a
  full note-taking system.  Lists are now "Notes" — markdown-style
  documents with rich editing support.
- **Sidebar webview** — Notes appear in the activity-bar sidebar (below
  Commands) as a rich webview with folder tree, search bar, tag pills,
  line counts, and inline action buttons.
- **Editor integration** — Clicking a note opens it in the main editor
  area using a virtual filesystem (`aplist:` scheme).  Multiple notes can
  be open in separate tabs simultaneously.
- **Markdown syntax highlighting** — Notes use the built-in Markdown
  grammar for headlines, bullet points, bold/italic, code blocks, etc.
  No render/preview mode — raw text with syntax colouring only.
- **Tag decorations** — Tags written as `#tagname` in note content are
  decorated inline with the tag's colour from the tag store (coloured
  background pill), updated on every edit with 300 ms debounce.
- **Auto-formatter** — `DocumentFormattingEditProvider` that normalises
  bullet style (`*` → `-`), ensures blank lines before headlines, trims
  trailing whitespace, and adds a final newline.
- **Auto-save on close** — Note content is automatically persisted when
  the editor tab is closed.
- **Nested folders** — Folders can contain sub-folders and notes with
  unlimited nesting depth.
- **Legacy migration** — Old `MiniList[]` data auto-converts to the new
  `NoteStore` format on first load.  Checklist items become markdown
  task-list syntax (`- [x]` / `- [ ]`).
- **17 new unit tests** covering migration, folder tree building, note
  filtering, line counting, and formatting helpers (78 total passing).

### Changed
- **Lists view location** — Moved from the bottom panel
  (`tulcase-panel`) to the activity-bar sidebar (`tulcase`).
- **View type** — Changed from plain tree to rich webview.
- **Commands** — Replaced 7 old `tulcase.list.*` commands with a
  single `tulcase.note.add` palette command.  All interactions
  happen through the webview sidebar.

### Removed
- **ListTreeProvider** — Replaced by `NoteListViewProvider` (webview).
- **Old list context menus** — No longer needed with webview action
  buttons.

---

## [0.5.0] – 2026-03-26

### Added
- **Command Webview** — The Commands view is now a rich webview (replacing
  the tree view), matching the TODO view's professional look and feel.
- **Folder organisation** — Commands can be assigned to folders that render
  as collapsible sections.  Create folders via the "+ Folder" button or
  while editing a command.
- **Collapsible code blocks** — Each command's shell text is hidden by
  default behind a "Show command" toggle.  Keeps the list compact while
  still allowing quick inspection.
- **Inline action buttons** — Edit (pen), Copy (clipboard), Send to
  Terminal (prompt), and Delete (trash) appear on hover for each command.
- **Search** — Full-text search bar that filters by label, command text,
  tags, and folder name.
- **Tag support** — Commands can be tagged using the existing colour-coded
  tag picker.  Tags display inline with coloured labels.
- **Legacy data migration** — Transparently converts old
  `Record<string, CommandEntry>` format to the new items-array format on
  first load.  Backwards-compatible with plain-string entries.
- **Tests** — 7 new unit tests covering migration, folder grouping, and
  sorting helpers.

### Changed
- **Command data model** — Switched from `Record<string, CommandEntry>` to
  `CommandItem[]` with `id`, `label`, `command`, `tags`, and `folder` fields.
- **Command view type** — Changed from `TreeDataProvider` to
  `WebviewViewProvider`.  All actions are handled via webview message
  passing instead of tree context menus.
- **package.json** — Commands view type set to `"webview"`.  Removed
  tree-based context menus for command items.

---

## [0.4.0] – 2026-03-25

### Added
- **TODO Webview** — The TODOs view is now a rich webview (replacing the
  tree view).  Three collapsible sections: **Active** (overdue + today),
  **Upcoming** (future), and **Done**.
- **Search** — Full-text search bar that filters todos by note text, tags,
  and displayed date.  Located at the top of the TODO view.
- **Two-line item layout** — Each todo displays the note on line 1 and
  due date (or "Today" / "Tomorrow" / "Yesterday") + colour-coded tags
  on line 2 in a smaller font.
- **Inline action buttons** — Edit (✏), Postpone (+1 day →), Mark Done (✓)
  appear on hover.  Done items show an Undo (↩) button instead.
- **Add / Quick-Add buttons** — Dedicated buttons at the top of the webview
  for adding new todos.
- **Auto-ID backfill** — Existing todos without IDs are automatically
  assigned unique IDs on first load (migration-safe).

### Changed
- **TODO view type** — Changed from `TreeDataProvider` to
  `WebviewViewProvider`.  All actions (mark done, postpone, edit, delete)
  are now handled via webview message passing instead of tree context menus.
- **Status bar** — Updated to use the new `TodoListViewProvider`.
- **Build pipeline** — `esbuild.mjs` now compiles both `record-calendar`
  and `todo-list` SCSS/HTML assets in a loop.
- **Commands cleaned up** — Removed tree-specific commands (`markDone`,
  `markUndone`, `moveToNextDay`, `reschedule`, `edit`, `delete`) from
  `package.json`; these are now webview-internal.  Kept `Add Todo`,
  `Quick Add Todo`, and `Toggle Show Done` for command-palette access.

---

## [0.3.0] – 2026-03-25

### Added
- **Tag Picker** — Reusable colour-coded tag selection popup (`pickTags()`).
  Shows all configured tags with colour-circle icons, grouped by category,
  with multi-select and pre-selection support.  Used in TODO add/edit flows
  and available for all entity types.
- **`tulcase.tag.changeCategory`** command — Change a tag's category
  from the tree-view context menu, with existing-category suggestions and
  a "New category…" option.
- **Tag picker tests** (5 tests) — Validates `groupByCategory()` sorting,
  empty-map handling, default-category fallback, and definition preservation.

### Changed
- **Expanded colour palette** — Tag colour picker now offers 16 colours
  (was 10): Red · Crimson · Orange · Yellow · Lime · Green · Teal · Cyan ·
  Blue · Indigo · Purple · Violet · Magenta · Pink · Rose · Gray.
- **Category selection** — Adding a tag now shows a QuickPick of existing
  categories (with a "New category…" option) instead of a free-text input.
- **TODO tree: rich tooltips** — Tag names in TODO tooltips now include
  colour swatches (● dots) in their assigned colour via Markdown HTML.
- **TODO tree: tag-aware** — `TodoTreeProvider` now receives `TagTreeProvider`
  so it can look up tag definitions for enriched display.
- **TODO add/edit** — Uses the new colour-coded `pickTags()` popup instead
  of the plain label-only QuickPick.

---

## [0.2.0] – 2026-03-25

### Added
- **Records: Calendar View** — `tulcase.records` is now a rich webview
  panel rendered in the bottom panel area (alongside the terminal).  
  Features:
  - Monthly calendar grid, colour-coded by hours worked per day
    (four intensity levels using VS Code theme colours — adapts to any theme).
  - Month navigation with `‹` / `›` arrows.
  - **Double-click** any day to log time and notes via a quick-input dialog.
  - **Detail panel** to the right of the calendar showing:
    - Month name, total hours logged, and average hours per worked day.
    - All entries (time + notes) for the selected day.
  - Today is highlighted with a blue ring; selected day has a primary-colour ring.
  - Context is retained when the panel is hidden (`retainContextWhenHidden`).

### Changed
- **View locations** restructured:
  - **Activity bar (left):** TODOs · Commands · Links · Tags
  - **Bottom panel:** Lists · Records
- `tulcase.record.add` command (title-bar `+` button / `Ctrl+Shift+…`)
  now refreshes the calendar view after logging instead of updating a tree.

### Fixed
- Suppressed benign startup warnings that appeared in the extension host
  console on VS Code ≥ 1.91 / Node.js ≥ 22:
  - `[DEP0040] punycode` deprecation (from transitive dependencies).
  - `ExperimentalWarning: SQLite is an experimental feature`.

---

## [0.1.0] – 2026-03-01

### Added
- Initial release: TODOs, Commands, Links, Lists, Tags, Records (tree view),
  recurring TODO sync, status bar, file watcher, quick-add keybinding.

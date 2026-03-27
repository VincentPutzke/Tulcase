# Changelog

All notable changes to the Tulcase VS Code extension are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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

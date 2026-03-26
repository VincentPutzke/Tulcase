# Changelog

All notable changes to the Arbeitsplatz VS Code extension are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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
  (`arbeitsplatz-panel`) to the activity-bar sidebar (`arbeitsplatz`).
- **View type** — Changed from plain tree to rich webview.
- **Commands** — Replaced 7 old `arbeitsplatz.list.*` commands with a
  single `arbeitsplatz.note.add` palette command.  All interactions
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
- **`arbeitsplatz.tag.changeCategory`** command — Change a tag's category
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
- **Records: Calendar View** — `arbeitsplatz.records` is now a rich webview
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
- `arbeitsplatz.record.add` command (title-bar `+` button / `Ctrl+Shift+…`)
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

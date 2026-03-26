# Changelog

All notable changes to the Arbeitsplatz VS Code extension are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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
-- **Inline action buttons** — Edit, Postpone (+1 day →), Mark Done
  appear on hover.  Done items show an Undo button instead.
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

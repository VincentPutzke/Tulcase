# Changelog

All notable changes to the Arbeitsplatz VS Code extension are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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

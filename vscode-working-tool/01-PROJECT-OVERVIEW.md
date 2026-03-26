# 01 — Project Overview & Vision

> **Tulcase VS Code Extension** — A native VS Code extension that brings the full
> Tulcase productivity suite (TODOs, time records, bookmarks, commands, lists, tags)
> directly into the editor, without leaving the IDE.

---

## 1. What We Are Building

A VS Code extension called **Tulcase** (working title: `vscode-tulcase`) that
replicates every feature of the existing Angular web application inside Visual Studio Code.
The extension will use native VS Code UI primitives — tree views, webview panels, quick picks,
status bar items, and the command palette — to deliver a first-class IDE experience that
feels like it was built for VS Code from the start.

### Core Principle

> **Same data, same features, VS Code look-and-feel.**

The user must be able to switch between the web UI and the VS Code extension seamlessly.
Both clients read and write the same JSON files on disk. The web app continues to work
as-is; the extension is an additional access point.

---

## 2. Goals

| # | Goal | Priority |
|---|------|----------|
| G1 | **Feature parity** with the web app (todos, records, commands, links, lists, tags, recurring) | Must-have |
| G2 | **VS Code-native UI** — no embedded web browser feel; use tree views, quick picks, editor decorations, webview panels where appropriate | Must-have |
| G3 | **System-wide shared data** — multiple VS Code windows (and the web app) share the same JSON databases stored in a user-space directory | Must-have (infra-ready for v1, full support in v2) |
| G4 | **Offline-first / local-first** — no cloud, no network; data lives on disk | Must-have |
| G5 | **Minimal setup** — install the VSIX, point at a data directory (or use the default), and go | Must-have |
| G6 | **Dark theme consistency** — respect the user's active VS Code theme; no hardcoded colors | Must-have |
| G7 | **Keyboard-first workflows** — command palette integration, keybindings for all common actions | Must-have |
| G8 | **Multi-instance safety** — concurrent read/write from multiple VS Code windows without data loss | Should-have (v2) |
| G9 | **Performance** — instant load for all views; no perceptible delay on any action | Should-have |
| G10 | **Extensibility** — clean internal architecture that allows adding new modules easily | Nice-to-have |

---

## 3. What the Web App Does Today

The existing Tulcase application (v1.0.0) is a two-tier system:

1. **Backend** — Python 3.11 / FastAPI REST server on port 8321
2. **Frontend** — Angular 21 SPA on port 4200

### Feature Inventory

| Module | Description | Backend Endpoints | Storage |
|--------|-------------|-------------------|---------|
| **TODOs** | Task management with date bucketing (overdue/today/tomorrow/upcoming/done), inline editing, tag support, mark-done/reschedule/delete | `GET/POST/PUT/DELETE /api/todos/{idx}` | `todo_db/todos.json` |
| **Recurring** | Configurable repeating tasks (daily/weekly/monthly); auto-generates todo items per schedule | `GET/POST/PUT/DELETE /api/recurring/{id}`, `POST /api/recurring/{id}/instance` | `todo_db/recurring.json` |
| **Tags** | Global tag registry with color and category; propagation across all modules on rename/delete | `GET/POST/PUT/DELETE /api/tags` | `tags_db/tags.json` |
| **Records** | Daily time tracking with calendar view, month navigation, flexible time parsing (1:30, 1.5h, 90m) | `GET /api/records/{year}/{month}`, `GET /api/records/index`, `POST /api/records/daily` | `records_db/{year}/{month}.json` |
| **Commands** | Snippet library with label, command text, tags; copy-to-clipboard, duplicate detection | `GET/POST/PUT/DELETE /api/commands/{label}` | `commands_db/commands.json` |
| **Links** | Nested bookmark tree (folders + links); drag-and-drop reorder/move, favicon display, deep search | `GET/PUT /api/links`, `POST/PUT/DELETE /api/links/node/{id}`, `POST /api/links/move` | `links_db/links.json` |
| **Lists** | Mini checklist boards with items, tags, auto-tag per list; progress tracking | `GET/POST/PUT/DELETE /api/lists/{id}`, item sub-routes | `lists_db/lists.json` |
| **Dashboard** | Overview with greeting, today's open todos, quick stat cards, and navigation links | (composes data from todos + commands) | — |

### Data Model

All data is stored as flat JSON files on disk under `*_db/` directories. There is no
database engine; the `json_store.py` service provides atomic `read_json` / `write_json`
primitives with auto-directory creation and pretty-printed output.

### Tag System

Tags are the cross-cutting concern of the entire application:
- Every entity (todo, recurring action, command, link, list, list item) can carry tags.
- The tag registry (`tags_db/tags.json`) stores name → `{color, category}`.
- Renaming or deleting a tag propagates across ALL stores via `tag_propagation.py`.
- Auto-tags: creating a list automatically creates a `#list:slug` tag.

### Test Suite

The backend has 12 test files (pytest) covering all routes and services with 100% endpoint
coverage. Tests use per-test temp directories via `conftest.py` fixtures, ensuring full
isolation.

---

## 4. Why a VS Code Extension?

| Reason | Detail |
|--------|--------|
| **Context switching** | Developers live in VS Code; switching to a browser tab breaks flow |
| **Keyboard-first** | VS Code's command palette and keybindings are superior to any web UI for power users |
| **Native integration** | Can integrate with the terminal, file explorer, SCM, and other extensions |
| **Always visible** | Side-panel tree views and status bar items are always accessible |
| **No server required** | The extension can read/write JSON files directly — the Python server becomes optional |
| **Distribution** | A VSIX package is trivial to install; no Python/Node setup needed by the end-user |

---

## 5. Success Criteria

The extension is considered successful when:

1. A user can perform every action available in the web app entirely from within VS Code.
2. Data created in the web app appears immediately in the extension (and vice versa).
3. The extension loads in under 500ms and all operations complete in under 200ms.
4. No data corruption occurs when two VS Code windows operate on the same data directory.
5. The extension passes all automated tests and has ≥90% code coverage.
6. The VSIX package size is under 2 MB (no bundled runtime).

---

## 6. Out of Scope (for v1)

- Mobile / web version of the extension
- Real-time collaborative editing
- Cloud sync or remote server support
- Feature Ideas #1–#25 from `feature-ideas.md` (those can be added in later versions)
- Migration tooling from other productivity apps

---

*Next: [02-CURRENT-ARCHITECTURE.md](02-CURRENT-ARCHITECTURE.md) — Deep analysis of the existing codebase.*

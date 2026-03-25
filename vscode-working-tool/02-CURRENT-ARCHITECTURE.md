# 02 — Current Architecture Analysis

> Deep inspection of the existing Arbeitsplatz codebase: backend, frontend, data layer,
> and cross-cutting concerns. This document forms the basis for the migration strategy.

---

## 1. High-Level Architecture

```
Browser (localhost:4200)
    │
    │  HTTP (proxied /api/* requests)
    ▼
Angular Dev Server (port 4200)
    │
    │  Proxy: /api/* → localhost:8321
    ▼
Python API Server (port 8321)  ← FastAPI + uvicorn
    │
    │  Read / Write (sync, blocking I/O)
    ▼
JSON Files on Disk (*_db/ directories)
```

### Key Characteristics

- **Two-process model**: Angular dev server + Python API server.
- **REST-only communication**: All data flows through HTTP JSON endpoints.
- **File-based persistence**: No database engine; flat JSON files with pretty-print.
- **Stateless server**: No session, no auth, no cache — read from disk on every request.
- **Single-user**: No multi-tenancy, no user accounts.

---

## 2. Backend (Python / FastAPI)

### 2.1 Entry Point

| File | Purpose |
|------|---------|
| `backend/run.py` | Creates the FastAPI app, starts uvicorn on port 8321 |

```
backend/
├── run.py                    # uvicorn entry point
├── app/
│   ├── __init__.py
│   ├── config.py             # Settings dataclass, path resolution
│   ├── dependencies.py       # DI: get_settings() singleton
│   ├── main.py               # App factory, CORS, router registration, lifespan
│   ├── models/               # Pydantic request/response models (8 files)
│   ├── routers/              # Route handlers, one per domain (7 files)
│   └── services/             # Business logic & helpers (6 files)
└── tests/                    # pytest suite (12 files, ~950 lines)
```

### 2.2 Configuration (`config.py`)

```python
@dataclass(frozen=True)
class Settings:
    base_dir: Path
    todos_file: Path       # {base}/todo_db/todos.json
    tags_file: Path        # {base}/tags_db/tags.json
    recurring_file: Path   # {base}/todo_db/recurring.json
    commands_file: Path    # {base}/commands_db/commands.json
    links_file: Path       # {base}/links_db/links.json
    lists_file: Path       # {base}/lists_db/lists.json
    records_dir: Path      # {base}/records_db/
    todo_page: Path        # {base}/notes/todos.md
    todo_tags_file: Path   # {base}/todo_db/tags.json
```

**Resolution order**: `ARBEITSPLATZ_BASE_DIR` env var → project root (2 levels above `config.py`).

This is the single configuration object. We can replicate it identically in TypeScript.

### 2.3 Storage Layer (`json_store.py`)

Two functions:
- `read_json(path, default)` → reads file, creates with default if missing.
- `write_json(path, data)` → writes pretty-printed JSON, creates parent dirs.

**Concurrency model**: None. No locks, no atomic writes, no versioning. Two concurrent
writers can corrupt data (last-write-wins). This is acceptable for single-user/single-window
but will need addressing for multi-instance.

### 2.4 Routers (7 domains)

| Router | Prefix | Key Behavior |
|--------|--------|--------------|
| `todos.py` | `/api/todos` | CRUD by array index; triggers recurring sync on GET; renders markdown todo page |
| `tags.py` | `/api/tags` | CRUD with propagation (rename/delete ripples to all stores) |
| `recurring.py` | `/api/recurring` | CRUD + instance status tracking; daily/weekly/monthly scheduling |
| `commands.py` | `/api/commands` | CRUD by label key; auto-migrates old string format to rich format |
| `links.py` | `/api/links` | Tree CRUD: add/update/delete/move nodes; recursive find/remove helpers |
| `lists.py` | `/api/lists` | CRUD for lists + nested items; auto-tag lifecycle management |
| `records.py` | `/api/records` | Read by year/month; create daily entries; records-index endpoint |

### 2.5 Services (6 helpers)

| Service | Purpose |
|---------|---------|
| `json_store.py` | Generic JSON read/write primitives |
| `link_tree.py` | Recursive tree traversal: find_node, remove_node, count_links |
| `tag_propagation.py` | Cross-store tag rename/delete propagation |
| `recurring_generation.py` | Schedule matching & idempotent todo generation |
| `time_utils.py` | Flexible time parsing (1:30, 1.5h, 90m, etc.) |
| `todo_page.py` | Renders todos as a markdown file |

### 2.6 Pydantic Models (8 files)

Each domain has Create/Update models with validation:
- `TodoCreate(note, date?, tags?)`, `TodoUpdate(note?, date?, done?, tags?)`
- `TagCreate(name, color?, category?)`, `TagUpdate(newName?, color?, category?)`
- `RecurringCreate(note, schedule, tags?)` with `RecurringSchedule(type, weekdays?, weeks?)` + model validator
- `CommandCreate(label, command, tags?)`, `CommandUpdate(command?, tags?)`
- `LinkNodeCreate(node, parentId?)`, `LinkNodeUpdate(label?, url?, expanded?, tags?)`, `LinkMove(nodeId, targetParentId?, index?)`
- `ListCreate(label, description?, tags?)`, `ListUpdate(label?, description?, tags?)`
- `ListItemCreate(text, tags?)`, `ListItemUpdate(text?, done?, tags?)`
- `DailyRecordCreate(date, time, notes)`
- `OkResponse(ok: bool)`

---

## 3. Frontend (Angular 21)

### 3.1 App Shell

```
webapp/src/app/
├── app.ts                # Root component: sidebar + router-outlet
├── app.html              # Shell layout: collapsible sidebar + main content
├── app.routes.ts         # 7 lazy-loaded routes (dashboard, todos, records, commands, links, lists, tags)
├── app.scss              # Dark-themed sidebar and layout styles
├── components/
│   ├── base-db/          # Abstract base component with loading/error/data/search/filter signals
│   ├── dashboard/        # Dashboard: greeting, stat cards, today's todos
│   ├── todos/            # 685-line component: date-bucketed lists, inline edit, recurring management
│   ├── records/          # Calendar view with expandable day cells, time entry forms
│   ├── commands/         # Snippet list with copy, duplicate detection, tag filtering
│   ├── links/            # Recursive tree with drag-and-drop, inline edit, favicon
│   ├── lists/            # Card grid with item CRUD, progress bars
│   ├── tags/             # Registry view grouped by category, color picker
│   └── shared/           # 14 reusable UI components
├── models/               # TypeScript interfaces (6 files, mirroring Pydantic models)
├── services/
│   ├── data.service.ts   # Central HTTP client (280 lines, ~35 methods)
│   └── todo-view-state.service.ts  # Filter/preset state with localStorage persistence
└── utils/
    └── text-input-shortcuts.ts  # Ctrl+key shortcuts for text inputs
```

### 3.2 Component Architecture

All feature components extend `BaseDbComponent<T>`:
- **Signals** for reactive state: `data`, `loading`, `error`, `searchQuery`, `filterTags`, `tagMap`
- **Tag color lookup** via shared `tagMap` signal
- **Search/filter** matching via `matchesCriteria()` / `matchesFilter()`
- **Date helpers**: `todayStr()`, `tomorrowStr()`, `formatDate()`, `formatDisplayDate()`

### 3.3 Shared Components (14)

| Component | Lines | Purpose | VS Code Equivalent |
|-----------|-------|---------|-------------------|
| `AddFormComponent` | 529 | Multi-mode configurable form with tag autocomplete | Webview form or Quick Pick sequence |
| `ActionButtonComponent` | — | Icon button with style variants | — (built into webview) |
| `ConfirmActionComponent` | — | Two-step delete confirmation | VS Code `showWarningMessage` |
| `DbPageHeaderComponent` | — | Page header with icon, title, count, refresh | Webview header section |
| `EmptyStateComponent` | — | Empty-state placeholder | Webview welcome view or tree view message |
| `ErrorStateComponent` | — | Error with retry | Webview error panel |
| `IconComponent` | — | 30+ SVG icons (inline rendered) | Codicons / ThemeIcons |
| `InlineEditComponent` | — | Inline text editor with tags | Webview inline edit |
| `ItemCardComponent` | — | Generic card shell (3 slots) | Webview card element |
| `LoadingSpinnerComponent` | — | Three-ring spinner | VS Code `ProgressLocation` |
| `SearchBarComponent` | — | Search input with tag autocomplete and filter pills | `QuickPick` or webview search |
| `TagAutocompleteComponent` | — | `#`-triggered tag dropdown | Custom webview autocomplete |
| `TagListComponent` | — | Read-only colored tag pills | Webview tag badges |
| `InlineEditComponent` | — | Inline editor with save/cancel | Webview inline forms |

### 3.4 Design System

**SCSS Variables** (dark theme):
- Background: `#0a0b10` (primary), `#12131a` (secondary)
- Accent colors: `#7c6aff` (primary), `#00e5a0` (secondary), `#ffb547` (warning), `#ff5c5c` (danger), `#4dabf7` (info)
- Typography: Inter (UI), JetBrains Mono (code)
- Spacing: 0.25rem–3rem scale
- Border radius: 6px–9999px
- Transitions: 150ms–500ms

**Important**: The VS Code extension should NOT replicate this design system. It must use VS Code's built-in theme tokens (`--vscode-*` CSS variables) to respect the user's chosen theme.

### 3.5 Data Flow

```
User Action → Component method → DataService.method() → HTTP POST/PUT/DELETE /api/...
                                                               ↓
                                            Python router handler → json_store.read/write
                                                               ↓
                                            JSON Response → DataService observable
                                                               ↓
                                            Component signal update → UI re-render
```

The `DataService` has a fallback: if API calls fail, it attempts to load static JSON from
`/assets/` — a development convenience that won't be needed in the extension.

---

## 4. Data Layer — JSON Schemas

### 4.1 `todo_db/todos.json`
```json
{
  "items": [
    { "note": "Buy milk", "date": "2026-03-16", "done": false, "tags": ["#shopping"] }
  ]
}
```

### 4.2 `tags_db/tags.json`
```json
{
  "tags": {
    "#work": { "color": "#7c6aff", "category": "general" },
    "#list:shopping": { "color": "#7c6aff", "category": "list" }
  }
}
```

### 4.3 `todo_db/recurring.json`
```json
{
  "actions": [
    {
      "id": "rec_1234567890",
      "note": "Daily standup",
      "tags": ["#recurrent"],
      "schedule": { "type": "daily" },
      "active": true,
      "lastCreatedDate": "2026-03-16",
      "instances": { "2026-03-16": { "status": "done" } }
    }
  ]
}
```

### 4.4 `commands_db/commands.json`
```json
{
  "commands": {
    "git status": { "command": "git status --short", "tags": ["#git"] }
  }
}
```

### 4.5 `links_db/links.json`
```json
{
  "root": [
    {
      "id": "ln_1234", "type": "folder", "label": "Dev", "expanded": true,
      "children": [
        { "id": "ln_5678", "type": "link", "label": "GitHub", "url": "https://github.com",
          "createdAt": "2026-03-16", "tags": ["#dev"] }
      ]
    }
  ]
}
```

### 4.6 `lists_db/lists.json`
```json
{
  "lists": [
    {
      "id": "ml_1234", "label": "Shopping", "description": "", "tags": [],
      "createdAt": "2026-03-16",
      "items": [
        { "id": "li_5678", "text": "Bread", "done": false, "tags": [], "createdAt": "2026-03-16" }
      ]
    }
  ]
}
```

### 4.7 `records_db/{year}/{month}.json`
```json
{
  "year": 2026, "month": 3,
  "days": {
    "2026-03-16": [
      { "time_spent_min": 90, "notes": "Worked on extension planning" }
    ]
  }
}
```

---

## 5. Cross-Cutting Concerns

### 5.1 Tag Propagation

When a tag is renamed or deleted, `tag_propagation.py` walks ALL stores:
- `todos.json` → items[].tags
- `recurring.json` → actions[].tags
- `commands.json` → commands{}.tags
- `links.json` → recursive tree nodes[].tags
- `lists.json` → lists[].tags + lists[].items[].tags

This **must** be replicated in the extension's data layer with the same behavior.

### 5.2 Recurring Todo Generation

`recurring_generation.py` runs on every GET `/api/todos`:
- Iterates all active recurring actions
- Checks if today matches the schedule (daily / weekly weekday / monthly weekday+week)
- Creates a new todo if `lastCreatedDate` ≠ today and no duplicate exists
- Idempotent: multiple calls on the same day produce one todo

This logic must run in the extension too — either on activation or on every "show todos" action.

### 5.3 Todo Markdown Page

`todo_page.py` writes a `notes/todos.md` file whenever todos change. This is a
nice-to-have for the extension (could show the markdown in a read-only editor).

---

## 6. Test Coverage

The backend has comprehensive tests:

| Test File | Domain | Key Areas |
|-----------|--------|-----------|
| `test_todos.py` | Todos | CRUD, date defaults, pagination, markdown page, recurring trigger |
| `test_tags.py` | Tags | CRUD, rename propagation, delete stripping |
| `test_commands.py` | Commands | CRUD, format migration, duplicate detection |
| `test_links.py` | Links | Tree CRUD, nested operations, drag-move, parent validation |
| `test_lists.py` | Lists | CRUD, items, auto-tag lifecycle |
| `test_records.py` | Records | CRUD, time format parsing, index endpoint |
| `test_recurring.py` | Recurring | CRUD, instance status, schedule validation |
| `test_recurring_generation.py` | Recurring gen | Daily/weekly/monthly, idempotency, migration |
| `test_tag_propagation.py` | Tag propagation | Strip/rename across stores, tree recursion |
| `test_services.py` | Services | json_store, link_tree, time_utils, todo_page |
| `conftest.py` | Shared fixtures | Temp directories, seed data, test client |

---

## 7. Reusability Assessment

| Component | Reusable As-Is | Needs Porting | Notes |
|-----------|---------------|---------------|-------|
| JSON schemas | ✅ | — | Same files, same format |
| `json_store.py` logic | — | ✅ → TypeScript | Simple read/write; trivial to rewrite |
| `link_tree.py` | — | ✅ → TypeScript | Pure functions; direct translation |
| `tag_propagation.py` | — | ✅ → TypeScript | Cross-file update logic; critical |
| `recurring_generation.py` | — | ✅ → TypeScript | Schedule matching; medium complexity |
| `time_utils.py` | — | ✅ → TypeScript | Regex parsing; trivial |
| Pydantic models | — | ✅ → TS interfaces | Already have Angular equivalents |
| Angular components | ❌ | — | Not usable; VS Code has different UI model |
| Angular `DataService` | — | Partially | HTTP client logic maps to direct file I/O |
| SCSS design system | ❌ | — | Must use VS Code theme tokens instead |
| Test patterns | — | ✅ → Jest/Vitest | Test logic applies; framework changes |

---

*Next: [03-VSCODE-EXTENSION-ARCHITECTURE.md](03-VSCODE-EXTENSION-ARCHITECTURE.md) — Target architecture for the extension.*

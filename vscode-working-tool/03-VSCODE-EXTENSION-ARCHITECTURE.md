# 03 — VS Code Extension Architecture

> Target architecture for the Arbeitsplatz VS Code extension. Describes the internal
> structure, module boundaries, data flow, and technology choices.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        VS Code Extension Host                       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────────────┐ │
│  │  Extension    │  │  Data Layer      │  │  UI Layer             │ │
│  │  Entry Point  │──│  (TypeScript)    │──│                       │ │
│  │  extension.ts │  │                  │  │  Tree Views           │ │
│  └──────────────┘  │  JsonStore        │  │  Webview Panels       │ │
│         │          │  TagPropagation   │  │  Quick Picks          │ │
│         │          │  RecurringSync    │  │  Status Bar           │ │
│         │          │  LinkTree         │  │  Commands             │ │
│         ▼          │  TimeUtils        │  │  Notifications        │ │
│  ┌──────────────┐  │                  │  └───────────────────────┘ │
│  │  Command      │  │  File Watcher    │             │             │
│  │  Registry     │  │  (fs.watch)      │             │             │
│  └──────────────┘  └──────────────────┘             │             │
│                           │                          │             │
└───────────────────────────┼──────────────────────────┼─────────────┘
                            │                          │
                            ▼                          │
                    ┌──────────────────┐               │
                    │  JSON Files      │               │
                    │  on Disk         │◄──────────────┘
                    │  (~/.arbeitsplatz│   (webview postMessage
                    │   or custom dir) │    → extension host
                    └──────────────────┘    → file write)
```

### Key Design Decision: No Server Required

The extension reads and writes JSON files **directly** via Node.js `fs` APIs. The Python
FastAPI server is NOT required. All business logic (tag propagation, recurring generation,
link tree operations, time parsing) is re-implemented in TypeScript within the extension.

**Why**: Requiring a running Python server would add complexity (process management, health
checks, port conflicts) and violate the "minimal setup" goal. The data format is simple
enough that direct file I/O is the right call.

The existing Python server continues to work independently — both clients share the same
JSON files.

---

## 2. Project Structure

```
vscode-tulcase/
├── .vscode/
│   ├── launch.json              # F5 debug config for Extension Dev Host
│   └── tasks.json               # Build tasks
├── src/
│   ├── extension.ts             # activate() / deactivate(), command registration
│   ├── config.ts                # Settings resolution (mirrors Python config.py)
│   ├── data/
│   │   ├── json-store.ts        # read/write JSON files with locks
│   │   ├── tag-propagation.ts   # rename/delete tag across all stores
│   │   ├── recurring-sync.ts    # schedule matching, idempotent todo generation
│   │   ├── link-tree.ts         # find/remove/count tree nodes
│   │   └── time-utils.ts        # flexible time parsing
│   ├── models/
│   │   ├── todo.model.ts        # TodoItem, RecurringAction, RecurringSchedule
│   │   ├── tag.model.ts         # TagRegistry, TagDef
│   │   ├── command.model.ts     # CommandEntry, CommandItem
│   │   ├── link.model.ts        # LinkNode, LinkFolder, LinkItem
│   │   ├── list.model.ts        # MiniList, ListItem
│   │   └── record.model.ts      # RecordDb, RecordEntry, CalendarDay
│   ├── providers/
│   │   ├── todo-tree.provider.ts      # TreeDataProvider for todos
│   │   ├── command-tree.provider.ts   # TreeDataProvider for commands
│   │   ├── link-tree.provider.ts      # TreeDataProvider for bookmarks
│   │   ├── list-tree.provider.ts      # TreeDataProvider for lists
│   │   ├── tag-tree.provider.ts       # TreeDataProvider for tags
│   │   └── record-tree.provider.ts    # TreeDataProvider for records index
│   ├── views/
│   │   ├── todo-webview.ts            # Webview panel for full todo management
│   │   ├── record-webview.ts          # Webview panel for calendar view
│   │   ├── link-webview.ts            # Webview panel for link tree (drag-drop)
│   │   ├── dashboard-webview.ts       # Webview panel for dashboard overview
│   │   └── webview-utils.ts           # Shared HTML/CSS generation, message handling
│   ├── commands/
│   │   ├── todo-commands.ts           # addTodo, markDone, reschedule, delete, etc.
│   │   ├── tag-commands.ts            # addTag, renameTag, deleteTag
│   │   ├── command-commands.ts        # addCommand, copyCommand, deleteCommand
│   │   ├── link-commands.ts           # addLink, addFolder, moveLink, deleteLink
│   │   ├── list-commands.ts           # addList, addListItem, toggleDone, deleteList
│   │   └── record-commands.ts         # addRecord, navigateMonth
│   ├── watchers/
│   │   └── file-watcher.ts            # fs.watch on data directories → refresh events
│   └── test/
│       ├── suite/
│       │   ├── json-store.test.ts
│       │   ├── tag-propagation.test.ts
│       │   ├── recurring-sync.test.ts
│       │   ├── link-tree.test.ts
│       │   ├── time-utils.test.ts
│       │   └── integration.test.ts
│       └── runTest.ts
├── media/
│   ├── icon.png                       # Extension icon (128x128)
│   ├── dark/                          # Dark theme tree view icons
│   └── light/                         # Light theme tree view icons
├── webview-ui/
│   ├── main.ts                        # Webview entry point (bundled separately)
│   ├── styles.css                     # VS Code theme-aware CSS
│   └── components/                    # Lightweight webview components
├── package.json                       # Extension manifest + contributes
├── tsconfig.json
├── esbuild.mjs                        # Build script (esbuild for speed)
├── .vscodeignore
├── CHANGELOG.md
├── README.md
└── LICENSE
```

---

## 3. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Extension host** | TypeScript 5.x | Required by VS Code extension API |
| **Build** | esbuild | ~100x faster than webpack; recommended by VS Code team |
| **Test** | Vitest or @vscode/test-electron | Vitest for unit tests; vscode-test for integration |
| **Webview UI** | Vanilla TS + VS Code Webview UI Toolkit | Lightweight, theme-aware, no framework overhead |
| **Icons** | Codicons (built-in) + custom SVG | Codicons for tree views; custom for branding |
| **Packaging** | @vscode/vsce | Official VSIX packaging tool |
| **Linting** | ESLint + Prettier | Consistent code style |

### Why Not React/Angular/Svelte for Webviews?

- The webviews in this extension are **data display + simple forms**, not complex SPAs.
- A framework adds bundle size, build complexity, and startup time to each webview.
- The VS Code Webview UI Toolkit provides styled components (`<vscode-button>`, `<vscode-text-field>`,
  `<vscode-checkbox>`, `<vscode-data-grid>`) that match the editor theme automatically.
- If complexity grows later, Svelte (smallest bundle) can be added incrementally.

---

## 4. Module Descriptions

### 4.1 `extension.ts` — Entry Point

```typescript
export function activate(context: vscode.ExtensionContext) {
    // 1. Resolve settings (data directory)
    // 2. Initialize data layer (JsonStore, file watcher)
    // 3. Run recurring sync on activation
    // 4. Register all commands
    // 5. Register tree data providers
    // 6. Register webview panel factories
    // 7. Register status bar items
}

export function deactivate() {
    // 1. Stop file watchers
    // 2. Dispose all providers
}
```

### 4.2 `config.ts` — Settings

Mirrors `backend/app/config.py`:

```typescript
interface ArbeitsplatzSettings {
    baseDir: string;         // default: ~/.arbeitsplatz (or custom)
    todosFile: string;       // {baseDir}/todo_db/todos.json
    tagsFile: string;        // {baseDir}/tags_db/tags.json
    recurringFile: string;   // {baseDir}/todo_db/recurring.json
    commandsFile: string;    // {baseDir}/commands_db/commands.json
    linksFile: string;       // {baseDir}/links_db/links.json
    listsFile: string;       // {baseDir}/lists_db/lists.json
    recordsDir: string;      // {baseDir}/records_db/
    todoPage: string;        // {baseDir}/notes/todos.md
}
```

The `baseDir` is configurable via VS Code settings (`arbeitsplatz.dataDirectory`).
Default: `~/.arbeitsplatz` on all platforms.

### 4.3 `data/json-store.ts` — Storage

```typescript
class JsonStore {
    async read<T>(filePath: string, fallback: T): Promise<T>;
    async write(filePath: string, data: unknown): Promise<void>;
}
```

Key improvements over the Python version:
- **Atomic writes** via write-to-temp-then-rename pattern
- **File locking** via `proper-lockfile` or a simple `.lock` file to prevent corruption from concurrent VS Code windows
- **Event emission** on write to trigger tree view refreshes

### 4.4 `watchers/file-watcher.ts` — Cross-Instance Sync

```typescript
class DataFileWatcher {
    // Watches all *_db/ directories for changes
    // Debounces events (100ms) to batch rapid writes
    // Fires domain-specific refresh events:
    //   onTodosChanged, onTagsChanged, onCommandsChanged, etc.
    // Filters out self-triggered writes to avoid refresh loops
}
```

This is the foundation for multi-instance support: when another VS Code window (or the
web app) modifies a JSON file, the watcher detects it and refreshes the affected views.

### 4.5 Tree Data Providers

Each domain gets a `TreeDataProvider<T>` that loads data from JSON and renders it as a
tree in the VS Code sidebar.

| Provider | Tree View ID | Node Types |
|---------:|:------------|:-----------|
| `TodoTreeProvider` | `arbeitsplatz.todos` | DateGroup → TodoItem |
| `CommandTreeProvider` | `arbeitsplatz.commands` | CommandItem (flat list) |
| `LinkTreeProvider` | `arbeitsplatz.links` | LinkFolder → LinkItem (recursive) |
| `ListTreeProvider` | `arbeitsplatz.lists` | MiniList → ListItem |
| `TagTreeProvider` | `arbeitsplatz.tags` | CategoryGroup → Tag |
| `RecordTreeProvider` | `arbeitsplatz.records` | Year → Month (navigation) |

### 4.6 Webview Panels

For complex views that can't be represented as trees (calendar, drag-and-drop, rich forms),
webview panels provide full HTML/CSS/JS rendering inside VS Code.

| Webview | Usage |
|---------|-------|
| `TodoWebview` | Full todo page with date buckets, inline edit, recurring management |
| `RecordWebview` | Monthly calendar with time entries, stats, navigation |
| `LinkWebview` | Drag-and-drop link tree (tree view alone can't do DnD between nodes) |
| `DashboardWebview` | Overview stats, today's todos, quick navigation |

Communication pattern:
```
Webview (HTML)            Extension Host (TS)
     │                           │
     │── postMessage({cmd}) ────>│── JsonStore.read/write ──> JSON file
     │                           │
     │<── postMessage({data}) ───│<── File Watcher event
```

### 4.7 Commands

All user-facing actions are registered as VS Code commands:

```
arbeitsplatz.todo.add
arbeitsplatz.todo.markDone
arbeitsplatz.todo.reschedule
arbeitsplatz.todo.moveToNextDay
arbeitsplatz.todo.delete
arbeitsplatz.todo.edit
arbeitsplatz.tag.add
arbeitsplatz.tag.rename
arbeitsplatz.tag.delete
arbeitsplatz.command.add
arbeitsplatz.command.copy
arbeitsplatz.command.delete
arbeitsplatz.link.addLink
arbeitsplatz.link.addFolder
arbeitsplatz.link.move
arbeitsplatz.link.delete
arbeitsplatz.list.add
arbeitsplatz.list.addItem
arbeitsplatz.list.toggleItem
arbeitsplatz.list.delete
arbeitsplatz.record.add
arbeitsplatz.record.navigateMonth
arbeitsplatz.openDashboard
arbeitsplatz.openSettings
arbeitsplatz.refresh
```

---

## 5. `package.json` Manifest — `contributes` Section

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "arbeitsplatz",
        "title": "Arbeitsplatz",
        "icon": "media/icon.svg"
      }]
    },
    "views": {
      "arbeitsplatz": [
        { "id": "arbeitsplatz.todos",    "name": "TODOs" },
        { "id": "arbeitsplatz.commands", "name": "Commands" },
        { "id": "arbeitsplatz.links",    "name": "Links" },
        { "id": "arbeitsplatz.lists",    "name": "Lists" },
        { "id": "arbeitsplatz.tags",     "name": "Tags" },
        { "id": "arbeitsplatz.records",  "name": "Records" }
      ]
    },
    "commands": [
      { "command": "arbeitsplatz.todo.add",       "title": "Add Todo",        "icon": "$(add)",   "category": "Arbeitsplatz" },
      { "command": "arbeitsplatz.todo.markDone",   "title": "Mark Done",       "icon": "$(check)", "category": "Arbeitsplatz" },
      { "command": "arbeitsplatz.command.add",     "title": "Add Command",     "icon": "$(add)",   "category": "Arbeitsplatz" },
      { "command": "arbeitsplatz.command.copy",    "title": "Copy Command",    "icon": "$(copy)",  "category": "Arbeitsplatz" },
      { "command": "arbeitsplatz.link.addLink",    "title": "Add Bookmark",    "icon": "$(add)",   "category": "Arbeitsplatz" },
      { "command": "arbeitsplatz.openDashboard",   "title": "Open Dashboard",  "icon": "$(home)",  "category": "Arbeitsplatz" },
      { "command": "arbeitsplatz.refresh",         "title": "Refresh All",     "icon": "$(refresh)","category": "Arbeitsplatz" }
    ],
    "menus": {
      "view/title": [
        { "command": "arbeitsplatz.todo.add",     "when": "view == arbeitsplatz.todos",    "group": "navigation" },
        { "command": "arbeitsplatz.command.add",   "when": "view == arbeitsplatz.commands", "group": "navigation" },
        { "command": "arbeitsplatz.link.addLink",  "when": "view == arbeitsplatz.links",    "group": "navigation" }
      ],
      "view/item/context": [
        { "command": "arbeitsplatz.todo.markDone",      "when": "viewItem == todoItem",     "group": "inline" },
        { "command": "arbeitsplatz.todo.moveToNextDay",  "when": "viewItem == todoItem",     "group": "1_actions" },
        { "command": "arbeitsplatz.todo.delete",         "when": "viewItem == todoItem",     "group": "2_danger" },
        { "command": "arbeitsplatz.command.copy",        "when": "viewItem == commandItem",  "group": "inline" },
        { "command": "arbeitsplatz.command.delete",      "when": "viewItem == commandItem",  "group": "2_danger" }
      ]
    },
    "configuration": {
      "title": "Arbeitsplatz",
      "properties": {
        "arbeitsplatz.dataDirectory": {
          "type": "string",
          "default": "",
          "description": "Path to the Arbeitsplatz data directory. Leave empty for default (~/.arbeitsplatz)."
        },
        "arbeitsplatz.showStatusBarItem": {
          "type": "boolean",
          "default": true,
          "description": "Show open todo count in the status bar."
        }
      }
    },
    "keybindings": [
      { "command": "arbeitsplatz.todo.add",        "key": "ctrl+shift+t", "mac": "cmd+shift+t" },
      { "command": "arbeitsplatz.command.add",     "key": "ctrl+shift+c", "mac": "cmd+shift+c" },
      { "command": "arbeitsplatz.openDashboard",   "key": "ctrl+shift+d", "mac": "cmd+shift+d" }
    ]
  }
}
```

---

## 6. Data Flow Diagram

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Command     │     │  Tree View   │     │  Webview      │
│  Palette     │     │  Click       │     │  UI Action    │
└──────┬──────┘     └──────┬──────┘     └──────┬───────┘
       │                   │                    │
       └───────────────────┼────────────────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │  Command Handler │
                  │  (commands/*.ts) │
                  └────────┬─────────┘
                           │
               ┌───────────┼───────────┐
               │           │           │
               ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ JsonStore │ │ TagProp  │ │ Recurring│
        │ read/    │ │ agation  │ │ Sync     │
        │ write    │ │          │ │          │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │            │
             └─────────────┼────────────┘
                           │
                           ▼
                  ┌──────────────────┐
                  │  JSON Files      │
                  │  on Disk         │
                  └────────┬─────────┘
                           │
                           ▼  (fs.watch event)
                  ┌──────────────────┐
                  │  File Watcher    │
                  └────────┬─────────┘
                           │
               ┌───────────┼───────────┐
               │           │           │
               ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │TreeView  │ │ Webview  │ │ Status   │
        │.refresh()│ │postMsg() │ │ Bar      │
        └──────────┘ └──────────┘ └──────────┘
```

---

## 7. Activation Strategy

```typescript
"activationEvents": [
    "onView:arbeitsplatz.todos",
    "onView:arbeitsplatz.commands",
    "onView:arbeitsplatz.links",
    "onView:arbeitsplatz.lists",
    "onView:arbeitsplatz.tags",
    "onView:arbeitsplatz.records",
    "onCommand:arbeitsplatz.todo.add",
    "onCommand:arbeitsplatz.openDashboard"
]
```

The extension activates lazily — only when a user opens the Arbeitsplatz sidebar or
invokes a command. This keeps VS Code startup fast.

---

*Next: [04-BACKEND-STRATEGY.md](04-BACKEND-STRATEGY.md) — Shared backend, data directory, and multi-instance approach.*

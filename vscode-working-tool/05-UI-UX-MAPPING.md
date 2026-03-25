# 05 — UI / UX Mapping: Web App → VS Code Extension

> Feature-by-feature mapping of every web UI element to VS Code primitives.
> This document ensures no functionality is lost in the translation.

---

## 1. VS Code UI Primitives Cheat Sheet

| Primitive | What it is | Best for |
|-----------|-----------|----------|
| **TreeView** | Hierarchical list in the sidebar | Navigation, browsing lists, folders |
| **Webview Panel** | Full HTML panel in the editor area | Complex forms, calendars, drag-and-drop |
| **QuickPick** | Dropdown search/select modal | Adding items, choosing from options |
| **InputBox** | Single-line text prompt | Simple text input |
| **StatusBarItem** | Small indicator in the bottom bar | Counters, quick actions |
| **Command** | Action in Command Palette (Ctrl+Shift+P) | Every user action |
| **Context Menu** | Right-click menu on tree items | Item-level actions |
| **Inline Actions** | Icon buttons on tree item hover | Quick actions (done, copy, delete) |
| **Notification** | Toast message (info/warning/error) | Confirmations, errors |
| **Progress** | Loading indicator | Long operations |
| **Decoration** | Overlay text/badges on tree items | Tag counts, status indicators |

---

## 2. Sidebar Layout

The extension contributes a dedicated Activity Bar icon (left rail) that opens the
**Arbeitsplatz** sidebar container with these views:

```
┌──────────────────────────┐
│  🏠  ARBEITSPLATZ         │  ← Activity Bar icon
├──────────────────────────┤
│  📋 TODOs           [+]  │  ← Tree View
│  ├─ ⚠ Overdue (2)       │
│  │  ├─ Buy groceries     │
│  │  └─ Fix bug #42       │
│  ├─ 📅 Today (3)         │
│  │  ├─ Daily standup     │
│  │  ├─ Code review       │
│  │  └─ Write report      │
│  ├─ 📅 Tomorrow (1)      │
│  │  └─ Team meeting      │
│  └─ 📅 This Week (2)     │
│     ├─ Deploy v2          │
│     └─ Update docs        │
├──────────────────────────┤
│  💻 Commands        [+]  │  ← Tree View
│  ├─ git status            │
│  ├─ docker ps             │
│  └─ ssh prod              │
├──────────────────────────┤
│  🔖 Links           [+]  │  ← Tree View
│  ├─ 📁 Dev               │
│  │  ├─ GitHub             │
│  │  └─ Stack Overflow     │
│  └─ 📁 Learning          │
│     └─ MDN Docs           │
├──────────────────────────┤
│  📋 Lists           [+]  │  ← Tree View
│  ├─ Shopping (3/5)        │
│  └─ Packing (0/8)        │
├──────────────────────────┤
│  🏷 Tags                  │  ← Tree View
│  ├─ general               │
│  │  ├─ #work              │
│  │  └─ #personal          │
│  └─ list                  │
│     └─ #list:shopping     │
├──────────────────────────┤
│  📊 Records               │  ← Tree View (year/month nav)
│  ├─ 2026                  │
│  │  ├─ March (42h)        │
│  │  ├─ February (38h)     │
│  │  └─ January (45h)      │
│  └─ 2025                  │
└──────────────────────────┘
```

---

## 3. Feature-by-Feature Mapping

### 3.1 Dashboard

| Web App | VS Code Extension |
|---------|------------------|
| Greeting banner ("Good morning, ...") | Status bar item: "🏠 Arbeitsplatz: 5 todos today" |
| Stat cards (open todos, overdue, commands, links) | Dashboard webview panel (Ctrl+Shift+D) |
| Today's todo list | Inline in TODOs tree view (already visible) |
| Navigation links | Not needed (sidebar handles navigation) |

**Implementation**: The dashboard is a **webview panel** opened via command palette or
keybinding. It shows cards with counts and quick links. Since the sidebar already provides
navigation, the dashboard is a bonus view, not the primary entry point.

### 3.2 TODOs

| Web App Feature | VS Code Primitive | Details |
|----------------|------------------|---------|
| Date-bucketed list (Overdue/Today/Tomorrow/ThisWeek/Later) | **TreeView** with parent nodes per bucket | `TodoItem.contextValue = 'todoItem'` |
| Add todo (text + date + tags) | **QuickPick** with multi-step: text → date → tags | Or: `InputBox` for quick add (text only, auto-today) |
| Mark as done | **Inline action** (check icon on hover) | Right-click → "Mark Done" |
| Reschedule to next day | **Inline action** or context menu | Updates `date` field |
| Delete | **Context menu** → "Delete" with confirmation | `vscode.window.showWarningMessage` |
| Edit note/date/tags | **Context menu** → "Edit" → QuickPick sequence | Or: opens in webview form |
| Tag display | **Tree item description** | `TreeItem.description = "#work #urgent"` |
| Done todos toggle | **View action toggle** (eye icon in tree header) | Filters tree to hide/show done items |
| Recurring task management | **Separate tree view section** or webview tab | CRUD via QuickPick + webview form |

**Inline add shortcut**: `Ctrl+Shift+T` opens an InputBox: type "Buy milk #shopping" → parsed
into `{ note: "Buy milk", tags: ["#shopping"], date: today }`.

### 3.3 Tags

| Web App Feature | VS Code Primitive | Details |
|----------------|------------------|---------|
| Tag registry grouped by category | **TreeView** with category parent nodes | `TagItem.iconPath` = colored circle icon |
| Add tag | **QuickPick** sequence: name → color → category | Color picker: list of preset colors |
| Edit tag (rename, recolor) | **Context menu** → "Rename" / "Change Color" | Rename triggers propagation |
| Delete tag | **Context menu** → "Delete" with confirmation | Triggers propagation (strip from all) |
| Color display | **TreeItem.iconPath** with colored SVG | Generate SVGs dynamically per color |

### 3.4 Records (Time Tracking)

| Web App Feature | VS Code Primitive | Details |
|----------------|------------------|---------|
| Monthly calendar view | **Webview panel** | HTML table with clickable day cells |
| Expand day → list of entries | Webview expansion within calendar | Click day → show entries inline |
| Add time entry (date, time, notes) | **QuickPick** sequence or webview form | Time parsing: "1:30", "1.5h", "90" |
| Month navigation (prev/next/select) | Webview buttons + **QuickPick** for month selection | |
| Total hours display | Webview header stat | "March 2026: 42h 30m" |
| Records index (year/month tree) | **TreeView** in sidebar | Click month → opens webview |

**Why webview**: A calendar grid cannot be represented as a tree view. The webview renders
a proper calendar table with VS Code theme colors.

### 3.5 Commands (Snippets)

| Web App Feature | VS Code Primitive | Details |
|----------------|------------------|---------|
| Flat list of command snippets | **TreeView** | `TreeItem.label = label`, `description = command` |
| Copy to clipboard | **Inline action** (copy icon on hover) | `vscode.env.clipboard.writeText()` |
| Add command | **QuickPick**: label → command → tags | |
| Delete command | **Context menu** → "Delete" | |
| Search/filter | Tree view built-in search (type to filter) | VS Code tree views support native filtering |
| Tag display | `TreeItem.description` includes tag names | |
| Paste to terminal | **Context menu** → "Run in Terminal" | `vscode.window.activeTerminal?.sendText()` |

**Bonus**: The "Run in Terminal" action is a natural VS Code integration that the web app
cannot provide. Sends the command text directly to the active terminal.

### 3.6 Links (Bookmarks)

| Web App Feature | VS Code Primitive | Details |
|----------------|------------------|---------|
| Nested folder tree | **TreeView** (recursive) | `TreeItem.collapsibleState` for folders |
| Open link in browser | **Inline action** (globe icon) | `vscode.env.openExternal(Uri.parse(url))` |
| Copy URL to clipboard | **Context menu** → "Copy URL" | `vscode.env.clipboard.writeText()` |
| Add link/folder | **QuickPick**: type (link/folder) → label → URL → parent | |
| Inline edit | **Context menu** → "Rename" / "Change URL" | `InputBox` prompts |
| Drag-and-drop reorder | **TreeView DnD** (VS Code 1.66+ tree DnD API) | `TreeDragAndDropController` |
| Favicon display | **TreeItem.iconPath** | Download and cache favicons, or use a generic globe icon |
| Deep search | Tree view filter + **QuickPick** search | |

**Drag-and-drop**: VS Code's `TreeDragAndDropController` API supports drag-and-drop within
and between tree views. This maps directly to the link move functionality.

### 3.7 Lists (Mini Checklists)

| Web App Feature | VS Code Primitive | Details |
|----------------|------------------|---------|
| List of lists with progress | **TreeView** parent nodes: "Shopping (3/5)" | `TreeItem.description = "3/5"` |
| Items within a list | Tree children: "☑ Bread" / "☐ Milk" | Checkbox via icon or unicode |
| Toggle done | **Inline action** (checkbox icon) | Click toggles done state |
| Add list | **QuickPick**: label → description → tags | |
| Add item | **Context menu** on list → "Add Item" → InputBox | |
| Delete list/item | **Context menu** → "Delete" | |

### 3.8 Recurring Task Management

| Web App Feature | VS Code Primitive | Details |
|----------------|------------------|---------|
| Recurring actions list | **TreeView** section within TODOs view, or separate webview tab | |
| Add recurring action | **QuickPick** multi-step: note → schedule type → weekdays → tags | |
| Edit schedule | **Context menu** → "Edit Schedule" → QuickPick | |
| Toggle active/inactive | **Inline action** (pause icon) | |
| Instance status (done/skipped/moved) | Context menu per generated instance | |

---

## 4. Interaction Patterns

### 4.1 Quick Add (Most Common Action)

```
User presses Ctrl+Shift+T
  → InputBox appears: "What do you need to do? (use #tag for tags)"
  → User types: "Review PR #work"
  → Extension parses: note="Review PR", tags=["#work"], date=today
  → Writes to todos.json
  → Tree view refreshes instantly
  → Status bar updates count
```

### 4.2 Copy Command Snippet

```
User clicks copy icon next to "git rebase -i HEAD~5" in Commands tree
  → Command text copied to clipboard
  → Notification: "Copied: git rebase -i HEAD~5"
```

### 4.3 Open Link

```
User clicks globe icon next to "GitHub" in Links tree
  → Browser opens https://github.com
```

### 4.4 Log Time

```
User runs "Arbeitsplatz: Log Time" from Command Palette
  → InputBox 1: "Date (YYYY-MM-DD, default: today)" → Enter
  → InputBox 2: "Time spent (e.g., 1:30, 1.5h, 90m)" → "1.5h"
  → InputBox 3: "Notes" → "Code review for PR #42"
  → Writes to records_db/2026/03.json
  → Records tree refreshes
```

### 4.5 Tag Auto-Complete

In any QuickPick that accepts tags, the extension provides:

```
User types "#" in the tags step
  → QuickPick shows all existing tags from tag registry
  → User selects "#work" and "#urgent"
  → Tags applied to the new item
```

---

## 5. Status Bar Integration

```
┌─────────────────────────────────────────────────────────────────┐
│ ... [other items] ...   📋 5 todos · 2 overdue   🕐 1:30 today │
└─────────────────────────────────────────────────────────────────┘
```

| Item | Display | Click Action |
|------|---------|-------------|
| Todo counter | "📋 5 todos · 2 overdue" | Opens TODO tree view |
| Today's hours | "🕐 1:30 today" | Opens Record webview for today |

Both items update automatically via the file watcher.

---

## 6. Webview Panel Design

All webview panels use VS Code's built-in CSS variables for theme compliance:

```css
body {
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
}

.card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 4px;
    padding: 12px;
}

button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    cursor: pointer;
}

button:hover {
    background: var(--vscode-button-hoverBackground);
}

.tag-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    /* Color loaded dynamically from tag registry */
}

.danger { color: var(--vscode-errorForeground); }
.warning { color: var(--vscode-editorWarning-foreground); }
.success { color: var(--vscode-testing-iconPassed); }
```

### VS Code Webview UI Toolkit Components

Use `@vscode/webview-ui-toolkit` for standard form elements:

```html
<vscode-text-field placeholder="Task description..."></vscode-text-field>
<vscode-dropdown>
    <vscode-option>Today</vscode-option>
    <vscode-option>Tomorrow</vscode-option>
</vscode-dropdown>
<vscode-button appearance="primary">Add Todo</vscode-button>
<vscode-checkbox>Include done items</vscode-checkbox>
<vscode-data-grid>...</vscode-data-grid>
```

---

## 7. Feature Comparison Matrix

| Feature | Web App | Extension (Tree) | Extension (Webview) | Extension (QuickPick) |
|---------|---------|------------------|--------------------|-----------------------|
| Browse todos | ✅ List | ✅ Tree view | ✅ Full page | — |
| Add todo | ✅ Form | — | ✅ Form | ✅ Quick add |
| Edit todo | ✅ Inline | ✅ Context menu | ✅ Form | ✅ Input prompts |
| Mark done | ✅ Checkbox | ✅ Inline icon | ✅ Checkbox | — |
| Browse commands | ✅ List | ✅ Tree view | — | — |
| Copy command | ✅ Button | ✅ Inline icon | — | — |
| Run in terminal | ❌ | ✅ **NEW** | — | — |
| Browse links | ✅ Tree | ✅ Tree view | ✅ DnD panel | — |
| Open link | ✅ Click | ✅ Inline icon | ✅ Click | — |
| Drag-drop links | ✅ DnD | ✅ Tree DnD | ✅ DnD | — |
| Calendar view | ✅ Grid | — | ✅ Grid | — |
| Add time entry | ✅ Form | — | ✅ Form | ✅ Steps |
| Browse lists | ✅ Cards | ✅ Tree view | — | — |
| Toggle item | ✅ Checkbox | ✅ Inline icon | — | — |
| Tag management | ✅ Panel | ✅ Tree view | — | ✅ Steps |
| Dashboard | ✅ Page | — | ✅ Panel | — |
| Search/filter | ✅ Search bar | ✅ Tree filter | ✅ Search box | ✅ Fuzzy search |
| Keyboard nav | ✅ Custom | ✅ **Native** | ✅ Custom | ✅ **Native** |

**Extension-Exclusive Features** (not in web app):
- Run command in terminal
- Paste command to terminal
- Open link tree item path in file explorer
- Quick todo from Command Palette
- Status bar todo/time counters
- File watcher cross-instance sync

---

*Next: [06-MIGRATION-PLAN.md](06-MIGRATION-PLAN.md) — Step-by-step implementation roadmap with milestones.*

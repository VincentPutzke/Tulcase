# 08 — Use Cases & User Stories

> Concrete usage scenarios that drive the extension's design. Each use case maps to
> implementation tasks from the migration plan.

---

## 1. Use Case Overview

| ID | Use Case | Primary Module | Phase |
|----|----------|---------------|-------|
| UC-01 | Quick-add a todo while coding | TODOs | 1 |
| UC-02 | Review and triage today's todos | TODOs | 1 |
| UC-03 | Mark a todo done from the sidebar | TODOs | 1 |
| UC-04 | Reschedule overdue todos | TODOs | 1 |
| UC-05 | Copy a command snippet to clipboard | Commands | 2 |
| UC-06 | Run a saved command in the terminal | Commands | 2 |
| UC-07 | Open a bookmarked link | Links | 2 |
| UC-08 | Organize bookmarks with drag-and-drop | Links | 2 |
| UC-09 | Check off items in a list | Lists | 2 |
| UC-10 | Log time spent on a task | Records | 2 |
| UC-11 | View monthly time summary | Records | 3 |
| UC-12 | Create and manage tags | Tags | 2 |
| UC-13 | Set up a new recurring task | Recurring | 2 |
| UC-14 | See dashboard overview | Dashboard | 3 |
| UC-15 | Share data between two VS Code windows | Multi-instance | 4 |
| UC-16 | First-time setup | Onboarding | 3 |

---

## 2. Detailed Use Cases

### UC-01: Quick-Add a Todo While Coding

**Actor**: Developer working in the editor  
**Trigger**: Developer thinks of a task while coding  
**Precondition**: Extension is installed and configured

**Main Flow**:
1. Developer presses `Ctrl+Shift+T` (without leaving the editor).
2. An InputBox appears at the top of VS Code: *"Add todo (use #tag for tags)"*.
3. Developer types: `Fix login validation #backend #urgent`.
4. Developer presses Enter.
5. Extension parses: note = "Fix login validation", tags = ["#backend", "#urgent"].
6. Extension writes the new todo to `todo_db/todos.json` with today's date.
7. The TODOs tree view refreshes; the new item appears under "Today".
8. Status bar updates: `📋 6 todos · 2 overdue`.
9. A subtle notification appears: *"Todo added: Fix login validation"*.
10. The InputBox closes; focus returns to the editor.

**Alternative Flow — With Date**:
- Developer types: `Deploy v2 2026-03-20 #devops`.
- Extension parses the date and assigns it instead of today.

**Post-condition**: Todo is persisted; all views updated.

---

### UC-02: Review and Triage Today's Todos

**Actor**: Developer starting the work day  
**Trigger**: Developer clicks the Tulcase icon in the Activity Bar

**Main Flow**:
1. The Tulcase sidebar opens showing all tree views.
2. The TODOs tree has groups: `⚠ Overdue (2)`, `📅 Today (4)`, `📅 Tomorrow (1)`, etc.
3. Developer expands "⚠ Overdue" and sees two tasks from last week.
4. Developer right-clicks the first overdue task → "Move to Today".
5. The task moves from "Overdue" to "Today"; tree refreshes.
6. Developer right-clicks the second overdue task → "Delete".
7. A confirmation prompt appears: *"Delete 'Old meeting notes'?"* → Yes.
8. Task is removed from the file; tree refreshes.

**Post-condition**: No overdue tasks remain.

---

### UC-03: Mark a Todo Done from the Sidebar

**Actor**: Developer who just completed a task  
**Trigger**: Task is done

**Main Flow**:
1. Developer locates the task in the TODOs tree view.
2. Developer clicks the ✓ (check) inline icon that appears on hover.
3. Extension sets `done: true` in the JSON file.
4. The tree item gets a strikethrough decoration or moves to a "Done" group.
5. Status bar updates the count.

**Alternative Flow — No Hover**:
- Developer right-clicks → "Mark Done" from context menu.
- Or: selects the tree item and presses `Enter`.

---

### UC-04: Reschedule Overdue Todos

**Actor**: Developer reviewing overdue items  
**Trigger**: Items are past due

**Main Flow**:
1. Developer right-clicks an overdue todo → "Reschedule".
2. A QuickPick appears with options: `Today`, `Tomorrow`, `Next Monday`, `Pick date...`.
3. Developer selects "Tomorrow".
4. Extension updates the todo's `date` field.
5. Tree view refreshes; item moves to "Tomorrow" group.

**Alternative Flow — Custom Date**:
- Developer selects "Pick date..." → InputBox appears → types `2026-03-25` → Enter.

---

### UC-05: Copy a Command Snippet to Clipboard

**Actor**: Developer needing a frequently used command  
**Trigger**: Developer needs to run a terminal command

**Main Flow**:
1. Developer expands the Commands tree view in the sidebar.
2. Developer sees: `git rebase -i HEAD~5` with description "interactive rebase".
3. Developer clicks the 📋 (copy) inline icon.
4. Command text is copied to clipboard.
5. Notification: *"Copied: git rebase -i HEAD~5"*.
6. Developer pastes into terminal.

---

### UC-06: Run a Saved Command in the Terminal

**Actor**: Developer wanting to execute a snippet directly  
**Trigger**: Developer sees a command they want to run

**Main Flow**:
1. Developer right-clicks a command in the tree → "Run in Terminal".
2. Extension checks for an active terminal; creates one if none exists.
3. Extension sends the command text to the terminal: `terminal.sendText(command)`.
4. Terminal executes the command.
5. Notification: *"Sent to terminal: git rebase -i HEAD~5"*.

**Post-condition**: Command is running in the terminal.

**Note**: This is an **extension-exclusive feature** not available in the web app.

---

### UC-07: Open a Bookmarked Link

**Actor**: Developer needing a reference URL  
**Trigger**: Developer needs to look something up

**Main Flow**:
1. Developer expands the Links tree → "Dev" folder → sees "GitHub".
2. Developer clicks the 🌐 (globe) inline icon.
3. Extension calls `vscode.env.openExternal(Uri.parse('https://github.com'))`.
4. Default browser opens the URL.

**Alternative Flow — Copy URL**:
- Right-click → "Copy URL" → URL copied to clipboard.

---

### UC-08: Organize Bookmarks with Drag-and-Drop

**Actor**: Developer reorganizing bookmarks  
**Trigger**: Developer wants to move a link to a different folder

**Main Flow**:
1. Developer drags "Stack Overflow" from the "General" folder.
2. Developer drops it on the "Dev" folder.
3. Extension calls `removeNode` + insert into target folder's `children`.
4. Writes updated tree to `links_db/links.json`.
5. Tree view refreshes showing the link in its new location.

**Alternative Flow — Context Menu**:
- Right-click → "Move to..." → QuickPick shows all folders → select target.

---

### UC-09: Check Off Items in a List

**Actor**: User working through a checklist  
**Trigger**: An item is completed

**Main Flow**:
1. Developer expands Lists tree → "Shopping (3/5)".
2. Developer sees: `☐ Bread`, `☑ Milk`, `☐ Eggs`, etc.
3. Developer clicks the checkbox icon on `☐ Bread`.
4. Extension sets `done: true` for that item.
5. Tree item changes to `☑ Bread`.
6. Parent label updates: "Shopping (4/5)".

---

### UC-10: Log Time Spent on a Task

**Actor**: Developer finishing a work session  
**Trigger**: Developer wants to record hours worked

**Main Flow**:
1. Developer opens Command Palette → "Tulcase: Log Time".
2. InputBox 1: *"Date (YYYY-MM-DD)"* → default shows today → Enter.
3. InputBox 2: *"Time spent"* → types `1:30` → Enter.
4. InputBox 3: *"Notes"* → types `Code review PR #42` → Enter.
5. Extension parses 1:30 → 90 minutes.
6. Writes to `records_db/2026/03.json`.
7. Records tree refreshes: "March" shows updated total hours.
8. Status bar: "🕐 1:30 today" (if it's today's entry).

---

### UC-11: View Monthly Time Summary

**Actor**: Developer reviewing their month  
**Trigger**: End of month, time reporting

**Main Flow**:
1. Developer clicks "March" in the Records tree.
2. A webview panel opens showing a calendar grid for March 2026.
3. Days with entries are highlighted; hovering shows entry details.
4. Header says: "March 2026 — 42h 30m total".
5. Developer clicks a day cell to see entries for that day.
6. Developer can add a new entry directly from the webview form.

---

### UC-12: Create and Manage Tags

**Actor**: Developer organizing their workspace  
**Trigger**: Needs a new tag or wants to rename/recolor one

**Main Flow — Add Tag**:
1. Developer clicks [+] in the Tags tree view header.
2. InputBox 1: *"Tag name"* → types `#devops`.
3. QuickPick: *"Color"* → selects from presets (purple, green, blue, ...).
4. QuickPick: *"Category"* → types `team` or selects existing.
5. Tag is added to `tags_db/tags.json`.
6. Tags tree refreshes.

**Main Flow — Rename Tag**:
1. Right-click `#backend` → "Rename Tag".
2. InputBox: *"New name"* → types `#be`.
3. Extension renames in tag registry AND propagates to all stores.
4. All tree views refresh (todos, commands, links, lists all show updated tag names).

---

### UC-13: Set Up a Recurring Task

**Actor**: Developer setting up repeating reminders  
**Trigger**: Developer wants a task every Monday

**Main Flow**:
1. Developer opens Command Palette → "Tulcase: Add Recurring Task".
2. InputBox: *"Task note"* → types `Weekly team sync`.
3. QuickPick: *"Schedule type"* → selects `Weekly`.
4. QuickPick (multi-select): *"On which days?"* → selects `Monday`.
5. QuickPick (multi-select): *"Tags"* → selects `#meetings`.
6. Recurring action saved to `todo_db/recurring.json`.
7. Next Monday, the extension automatically creates a todo "Weekly team sync".

---

### UC-14: See Dashboard Overview

**Actor**: Developer wanting a quick status check  
**Trigger**: Start of the day

**Main Flow**:
1. Developer presses `Ctrl+Shift+D` or runs "Tulcase: Dashboard".
2. A webview panel opens in the editor area.
3. Shows:
   - "Good morning! You have **5 todos today**, **2 overdue**."
   - Stat cards: Open Todos (12), Commands (28), Links (45), Lists (3).
   - Today's todos as a checklist.
   - Quick-action buttons: Add Todo, Log Time, Open Links.

---

### UC-15: Share Data Between Two VS Code Windows

**Actor**: Developer with two projects open  
**Trigger**: Both windows need the same todo list

**Main Flow**:
1. Both VS Code windows have the extension installed.
2. Both point to the same data directory (`~/.tulcase`).
3. Developer adds a todo in Window 1.
4. Window 1 writes to `todo_db/todos.json` (with lockfile).
5. Window 2's file watcher detects the change within ~100ms.
6. Window 2's TODOs tree view refreshes automatically.
7. Both windows now show the same todo.

**Error Flow — Concurrent Write**:
1. Window 1 and Window 2 attempt to write at the same time.
2. Window 1 acquires the lockfile first; Window 2 waits (retries 3x, 200ms apart).
3. Window 1 finishes; releases lock.
4. Window 2 acquires lock, reads the latest file, applies its change, writes, releases lock.
5. Both windows see the final state after file watcher events.

---

### UC-16: First-Time Setup

**Actor**: New user installing the extension  
**Trigger**: Extension activated for the first time

**Main Flow**:
1. Extension detects no configured data directory and no default directory exists.
2. A welcome webview panel opens: "Welcome to Tulcase!"
3. Options presented:
   - **Create new workspace**: Creates `~/.tulcase` with empty JSON stores.
   - **Use existing directory**: File picker / InputBox to select a path.
   - **Migrate from project**: Select a project root with `*_db/` directories;
     copies them to user-space.
4. Developer selects "Create new workspace".
5. Extension creates directory structure and empty JSON files.
6. The sidebar populates with empty tree views + welcome messages.
7. A sample todo is created: "✨ Welcome to Tulcase! Add your first task."

---

## 3. User Stories (Agile Format)

### Phase 1 — Core

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-01 | As a developer, I want to add a todo via keyboard shortcut so I don't lose my flow | Ctrl+Shift+T, InputBox, todo saved, tree updates |
| US-02 | As a developer, I want to see my todos grouped by date | Tree shows Overdue/Today/Tomorrow/ThisWeek/Later buckets |
| US-03 | As a developer, I want to mark a todo done with one click | Inline ✓ icon, done=true written, tree updates |
| US-04 | As a developer, I want to delete a todo with confirmation | Context menu, confirmation dialog, item removed |
| US-05 | As a developer, I want recurring tasks generated automatically | On activation, recurring sync creates due todos |
| US-06 | As a developer, I want to see my todo count in the status bar | Status bar: "📋 X todos · Y overdue" |

### Phase 2 — All Modules

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-07 | As a developer, I want to copy command snippets to clipboard | Copy icon, clipboard write, notification |
| US-08 | As a developer, I want to run commands directly in my terminal | "Run in Terminal" sends to active terminal |
| US-09 | As a developer, I want to browse and open bookmarks | Tree view, glob icon opens browser |
| US-10 | As a developer, I want to drag-and-drop bookmarks between folders | TreeDragAndDropController, file updated |
| US-11 | As a developer, I want to toggle list items done/undone | Checkbox icon, progress count updates |
| US-12 | As a developer, I want to manage my tag registry | CRUD via tree + commands, propagation works |
| US-13 | As a developer, I want to log time via the command palette | Multi-step InputBox, records saved |

### Phase 3 — Webviews

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-14 | As a developer, I want a dashboard overview | Webview with stats, today's todos |
| US-15 | As a developer, I want a calendar view for time records | Webview with monthly calendar grid |
| US-16 | As a new user, I want a guided first-time setup | Welcome webview, directory creation options |

### Phase 4 — Multi-Instance

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-17 | As a developer, I want changes from another window to appear automatically | File watcher refreshes within 100ms |
| US-18 | As a developer, I want concurrent writes to not corrupt data | Lockfile protection, no data loss |

---

## 4. Acceptance Test Plan

Each use case maps to a testable scenario:

| UC | Test Type | How Verified |
|----|----------|-------------|
| UC-01 | Integration | Mock InputBox → verify JSON file written with correct content |
| UC-02 | Unit | Seed 5 todos → verify tree groups match expected buckets |
| UC-03 | Integration | Call markDone command → verify JSON updated |
| UC-04 | Integration | Mock QuickPick → verify date updated |
| UC-05 | Integration | Call copy command → verify clipboard.writeText called with correct text |
| UC-06 | Integration | Mock terminal → verify sendText called |
| UC-07 | Integration | Call open command → verify openExternal called with URL |
| UC-08 | Unit | Call move logic → verify tree structure updated |
| UC-09 | Integration | Call toggleDone → verify item.done toggled |
| UC-10 | Integration | Mock InputBox sequence → verify records file written |
| UC-11 | E2E | Open records tree → click month → webview opens |
| UC-12 | Integration | Mock InputBox → verify tag created + propagated |
| UC-13 | Integration | Mock multi-step QuickPick → verify recurring.json updated |
| UC-14 | E2E | Run dashboard command → webview opens without error |
| UC-15 | Manual | Open two Extension Dev Hosts → write in one → verify other refreshes |
| UC-16 | E2E | Activate with no data dir → welcome panel appears |

---

*Next: [09-PROBLEMS-AND-SOLUTIONS.md](09-PROBLEMS-AND-SOLUTIONS.md) — Known challenges, edge cases, and resolution strategies.*

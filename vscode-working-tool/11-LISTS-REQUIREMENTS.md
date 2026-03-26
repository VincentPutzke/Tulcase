# v0.6.0 — Lists Rework: Requirements

## Overview

Transform the Lists feature from a simple checklist tree (bottom panel) into a
full-fledged **note-taking system** with a sidebar file explorer and a native
code-editor experience in the main editor area.

---

## 1. Sidebar — Note Explorer (WebviewViewProvider)

### 1.1 Location & Registration
- [ ] Move `tulcase.lists` from `tulcase-panel` (bottom panel) to
  `tulcase` (activity-bar sidebar), placed **below Commands**
- [ ] Change view type from plain tree to `"type": "webview"`
- [ ] Register as `WebviewViewProvider` (same pattern as TODOs / Commands)

### 1.2 Visual Style
- [ ] Match the visual language of the TODO and Command webviews (same spacing,
  fonts, colours, SVG icon style)
- [ ] Use VS Code theme colour tokens (`--vscode-*`) — no hardcoded colours

### 1.3 Folder Tree
- [ ] Top-level view shows folders and root-level notes
- [ ] Folders are **collapsible sections** (same pattern as Command folders)
- [ ] Folders can contain **sub-folders** and/or notes  (unlimited nesting)
- [ ] Folders display: folder icon + name + item count badge
- [ ] Folder action buttons: Add Note, Add Sub-folder, Rename, Delete

### 1.4 Note Items
Each note item in the sidebar displays:
- [ ] Note icon (document icon SVG)
- [ ] Note label (name)
- [ ] Tag pills (colour-coded, same as Todos/Commands)
- [ ] Line count (e.g. "12 lines")
- [ ] Action buttons: Edit metadata (name/tags/folder), Delete

### 1.5 Sidebar Interactions
- [ ] **Click** a note → opens it in the main editor area (see Section 2)
- [ ] **Add Note** button in view title bar (+ icon)
- [ ] **Add Folder** button in view title bar (folder+ icon)
- [ ] **Search bar** filters notes by label, tag, or content snippet

### 1.6 Empty State
- [ ] Display a friendly empty state with icon + "No notes yet" message +
  "Create your first note" call-to-action (consistent with other views)

---

## 2. Editor — Note Editing (FileSystemProvider)

### 2.1 Architecture
- [ ] Register a **virtual filesystem** with scheme `aplist:`
- [ ] URI format: `aplist:/<noteId>/<label>.md`  (label in the path for
  readable tab titles)
- [ ] `FileSystemProvider.readFile` → reads `content` field from JSON store
- [ ] `FileSystemProvider.writeFile` → persists `content` back to JSON store
- [ ] `FileSystemProvider.stat` → returns file metadata (size, mtime)
- [ ] `FileSystemProvider.watch` → no-op (we control writes)

### 2.2 Opening Notes
- [ ] Clicking a note in the sidebar calls
  `vscode.workspace.openTextDocument(uri)` + `vscode.window.showTextDocument()`
- [ ] The document opens in the **main editor area** (not a panel/sidebar)
- [ ] **Multiple notes can be open simultaneously** (separate tabs)
- [ ] Tab title shows the note label (derived from URI path)
- [ ] If the note is already open, focus the existing tab (don't duplicate)

### 2.3 Markdown-Style Syntax Highlighting
- [ ] Set the language mode to `markdown` for the `aplist` scheme so VS Code's
  built-in Markdown grammar provides:
  - Headlines (`# H1`, `## H2`, etc.)
  - Bullet points (`-`, `*`, `1.`)
  - Bold / italic / strikethrough
  - Code spans and fenced code blocks
  - Links and images
- [ ] **NO render/preview mode** — the user sees only the raw text with syntax
  colouring (never a split or preview pane)

### 2.4 Tag Decorations (inline, linting-style)
- [ ] Detect tags written in the text (e.g. `#work`, `#urgent`)
- [ ] Decorate them with the tag's colour from the tag store (coloured
  background pill or underline — same colour as the sidebar tag pills)
- [ ] Update decorations on every edit (debounced ~300 ms)
- [ ] Clicking a decorated tag could optionally show tag info (stretch goal)

### 2.5 Auto-format (on-type / on-save)
- [ ] Register a `DocumentFormattingEditProvider` for `aplist` documents
- [ ] Formatting rules:
  - Ensure blank line before headlines
  - Normalise bullet style (consistent `-` or `*`)
  - Trim trailing whitespace per line
  - Ensure file ends with a single newline
- [ ] Trigger format-on-type or format-on-save (configurable via standard VS
  Code settings `editor.formatOnType` / `editor.formatOnSave`)

### 2.6 Save Behaviour
- [ ] **Auto-save on close**: when the editor tab is closed, unsaved content is
  automatically persisted to the JSON store (no "Save?" dialog)
- [ ] Manual save (`Ctrl+S`) also works and writes immediately via the
  FileSystemProvider
- [ ] After save, refresh the sidebar to update line counts / last-modified info

---

## 3. Data Model

### 3.1 New Interfaces

```typescript
/** A single note (replaces the old MiniList) */
interface NoteItem {
    id: string;          // e.g. 'nt_abc12345'
    label: string;       // display name
    content: string;     // raw text (markdown-style)
    tags: string[];      // tag names
    folder: string;      // folder ID, '' = root
    createdAt: string;   // ISO date
    updatedAt: string;   // ISO date
}

/** A folder that can contain notes or other folders */
interface NoteFolder {
    id: string;          // e.g. 'nf_abc12345'
    name: string;        // display name
    parent: string;      // parent folder ID, '' = root
}

/** Root shape of lists.json (v2) */
interface NoteStore {
    notes: NoteItem[];
    folders: NoteFolder[];
}
```

### 3.2 Legacy Migration
- [ ] On first read, detect old format (`{ lists: MiniList[] }`)
- [ ] Convert each `MiniList` → `NoteItem`:
  - `label` → `label`
  - `description` → first line of `content` (if non-empty)
  - `items[]` → bullet list in `content`
    (`- [x] text` for done, `- [ ] text` for not-done)
  - `tags` → `tags`
  - `createdAt` → `createdAt` + `updatedAt`
  - `folder` → `''` (root)
- [ ] Write the migrated data back immediately
- [ ] Log a console message about the migration

### 3.3 Storage
- [ ] Continue using the existing `listsFile` path (`lists_db/lists.json`)
- [ ] Continue using `JsonStore` for atomic read/write
- [ ] File watcher (`onListsChanged`) fires refresh for both sidebar and any
  open editors

---

## 4. Commands & Keybindings

### 4.1 New / Updated Commands

| Command ID                         | Title              | Where       |
|------------------------------------|--------------------|-------------|
| `tulcase.note.add`            | Add Note           | Sidebar btn |
| `tulcase.note.addFolder`      | Add Folder         | Sidebar btn |
| `tulcase.note.open`           | Open Note          | Sidebar click / palette |
| `tulcase.note.editMeta`       | Edit Note Metadata | Sidebar btn |
| `tulcase.note.delete`         | Delete Note        | Sidebar btn |
| `tulcase.note.renameFolder`   | Rename Folder      | Sidebar btn |
| `tulcase.note.deleteFolder`   | Delete Folder      | Sidebar btn |

### 4.2 Removed Commands
- All old `tulcase.list.*` commands (add, addItem, toggleItem, edit,
  editItem, delete, deleteItem) — replaced by the new note commands

### 4.3 Menu Contributions
- [ ] Remove all `tulcase.list.*` context menu entries from `view/item/context`
- [ ] Remove `tulcase.list.add` from `view/title`
- [ ] No tree context menus needed (sidebar is a webview with its own buttons)

---

## 5. Package.json Changes

- [ ] Move `tulcase.lists` view from `tulcase-panel` to `tulcase`
  (after `tulcase.commands`, before `tulcase.links`)
- [ ] Set `"type": "webview"` on the lists view
- [ ] Register new `tulcase.note.*` commands
- [ ] Remove old `tulcase.list.*` commands
- [ ] Remove old list-related `view/item/context` and `view/title` menu entries
- [ ] Bump version to `0.6.0`

---

## 6. Extension Activation Changes

- [ ] Replace `ListTreeProvider` import with `NoteListViewProvider`
- [ ] Replace `registerTreeDataProvider('tulcase.lists', ...)` with
  `registerWebviewViewProvider(NoteListViewProvider.viewType, ...)`
- [ ] Register the `aplist:` FileSystemProvider
- [ ] Register the tag decoration provider for `aplist` documents
- [ ] Register the formatting provider for `aplist` documents
- [ ] Register auto-save-on-close listener
- [ ] Update file watcher to also refresh open `aplist` editors on external change
- [ ] Replace `registerListCommands` with new note command registration
  (or rewrite in-place)

---

## 7. Build Changes

- [ ] Add `{ name: 'note-list' }` to the `webviews` array in `esbuild.mjs`
- [ ] Create `src/views/note-list.html` (sidebar template)
- [ ] Create `src/views/note-list.scss` (sidebar styles)

---

## 8. Files to Create

| File                            | Purpose                                  |
|---------------------------------|------------------------------------------|
| `src/views/note-list.html`      | Sidebar webview HTML template            |
| `src/views/note-list.scss`      | Sidebar webview styles                   |
| `src/views/note-list.view.ts`   | WebviewViewProvider for sidebar          |
| `src/models/note.model.ts`      | NoteItem, NoteFolder, NoteStore types    |
| `src/data/note-fs.ts`           | FileSystemProvider (`aplist:` scheme)    |
| `src/data/note-format.ts`       | DocumentFormattingEditProvider            |
| `src/data/note-decorations.ts`  | Tag decoration logic for open editors    |
| `src/test/note-list.test.ts`    | Unit tests for data model + migration    |

## 9. Files to Modify

| File                              | Changes                                |
|-----------------------------------|----------------------------------------|
| `package.json`                    | View move, type change, commands, menus, version |
| `src/extension.ts`               | Provider registration, watcher, close listener |
| `esbuild.mjs`                    | Add note-list to webview assets        |
| `src/commands/list-commands.ts`   | Rewrite or replace with note commands  |
| `src/models/index.ts`            | Export new note models                 |

## 10. Files to Remove / Deprecate

| File                                   | Action                             |
|----------------------------------------|------------------------------------|
| `src/providers/list-tree.provider.ts`  | Remove (replaced by webview)       |
| `src/models/list.model.ts`             | Keep temporarily for migration types, then remove |

---

## 11. Testing

- [ ] Unit tests for legacy migration (`MiniList[]` → `NoteItem[]`)
- [ ] Unit tests for folder nesting helpers (getChildren, flattenTree, etc.)
- [ ] Unit tests for tag regex extraction from note content
- [ ] Unit tests for auto-format rules
- [ ] Manual test: create folder, create sub-folder, create note
- [ ] Manual test: open note, edit, save, verify JSON updated
- [ ] Manual test: open multiple notes in tabs simultaneously
- [ ] Manual test: close tab → content auto-saved
- [ ] Manual test: tag decoration colours match tag store
- [ ] Manual test: search filters notes correctly
- [ ] Manual test: legacy data migrates cleanly on first open
- [ ] Build passes (`npm run compile`)
- [ ] All tests pass (`npx vitest run`)

---

## 12. Out of Scope (future)

- Drag-and-drop reordering of notes/folders
- Note export to .md files
- Note import from .md files
- Full-text search across all note contents
- Note templates
- Collaborative editing / sync indicators

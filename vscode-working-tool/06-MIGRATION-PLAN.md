# 06 — Migration & Implementation Plan

> Step-by-step roadmap from zero to published VS Code extension. Four milestones,
> each shippable. Estimated effort and risk per phase.

---

## 1. Phase Overview

```
Phase 0 — Scaffold & Tooling          ~2 days
Phase 1 — Core Data + TODOs           ~5 days
Phase 2 — All Modules                 ~7 days
Phase 3 — Webviews + Polish           ~5 days
Phase 4 — Multi-Instance + Publish    ~4 days
────────────────────────────────────────────────
Total estimated effort                ~23 days (solo developer)
```

---

## 2. Phase 0 — Scaffold & Tooling (2 days)

### Goal
A running extension that activates, registers a "Hello World" command, and has the full
build/test/lint/debug toolchain working.

### Tasks

| # | Task | Output |
|---|------|--------|
| 0.1 | Initialize project: `npm init`, TypeScript config, esbuild build script | `vscode-tulcase/` skeleton |
| 0.2 | Create `package.json` with `contributes` manifest (views, commands, configuration) | Full manifest |
| 0.3 | Create `.vscode/launch.json` for Extension Dev Host debugging | F5 debugging works |
| 0.4 | Set up ESLint + Prettier config | Linting works |
| 0.5 | Set up Vitest for unit tests (non-VS Code) and `@vscode/test-electron` for integration | `npm test` works |
| 0.6 | Create `extension.ts` with `activate()` / `deactivate()` stubs | Extension loads in dev host |
| 0.7 | Create `config.ts` mirroring Python's `Settings` dataclass | Settings resolved on activation |
| 0.8 | Add `arbeitsplatz.dataDirectory` configuration setting | Configurable via Settings UI |

### Deliverable
- Extension loads in Extension Development Host.
- A single command ("Arbeitsplatz: Hello") appears in Command Palette.
- Build, lint, and test passes.

---

## 3. Phase 1 — Core Data Layer + TODOs (5 days)

### Goal
The data layer (JsonStore, tag propagation, recurring sync) and the first feature module
(TODOs) fully working in a tree view with CRUD operations.

### Tasks

| # | Task | Ported From |
|---|------|-------------|
| 1.1 | Implement `JsonStore` (read/write/atomic) | `json_store.py` |
| 1.2 | Implement `TimeUtils` (time parsing, date formatting) | `time_utils.py` |
| 1.3 | Implement `LinkTree` helpers (find/remove/count) | `link_tree.py` |
| 1.4 | Implement `TagPropagation` (rename/strip across all stores) | `tag_propagation.py` |
| 1.5 | Implement `RecurringSync` (schedule matching, idempotent generation) | `recurring_generation.py` |
| 1.6 | Define TypeScript interfaces for all models | `models/*.py` + Angular `models/` |
| 1.7 | Implement `TodoTreeProvider` with date bucketing | Angular `todos` component |
| 1.8 | Register TODO commands: add, markDone, moveToNextDay, edit, delete | `routers/todos.py` |
| 1.9 | Implement "Quick Add Todo" via InputBox with `#tag` parsing | Angular add-form |
| 1.10 | Add inline actions: ✓ (done), → (next day), ✕ (delete) | Angular button actions |
| 1.11 | Add status bar item: "📋 X todos · Y overdue" | Angular dashboard stats |
| 1.12 | Write unit tests for all data layer modules | `tests/` |
| 1.13 | Write integration tests for TodoTreeProvider | — |

### Deliverable
- Full CRUD for TODOs via tree view + command palette.
- Recurring tasks auto-generated on activation.
- Tag parsing in quick-add.
- Status bar counter.
- ≥90% test coverage on data layer.

### Risk
- Date bucketing logic is the most complex tree rendering task. The Angular component is
  ~685 lines; the tree provider will be ~200 lines (simpler because TreeView handles rendering).

---

## 4. Phase 2 — All Remaining Modules (7 days)

### Goal
Every module (tags, commands, links, lists, records) has a working tree view with full CRUD.

### Tasks

| # | Module | Days | Key Challenge |
|---|--------|------|--------------|
| 2.1 | **Tags** — TagTreeProvider, CRUD commands, color icons | 1 | Dynamic SVG icon generation for colors |
| 2.2 | **Commands** — CommandTreeProvider, copy/paste/run-in-terminal | 1 | Terminal integration |
| 2.3 | **Links** — LinkTreeProvider, recursive tree, DnD, open/copy URL | 1.5 | TreeDragAndDropController API |
| 2.4 | **Lists** — ListTreeProvider, nested items, toggle done | 1 | Nested tree rendering |
| 2.5 | **Records** — RecordTreeProvider (year/month/nav) | 0.5 | Simple tree; detail in webview (Phase 3) |
| 2.6 | **Recurring** — RecurringTreeProvider or section in TODOs | 1 | Schedule display, CRUD |

### Per-Module Pattern

Each module follows the same implementation pattern:

```
1. Create TreeDataProvider (read from JsonStore, build tree items)
2. Register tree view in package.json
3. Implement command handlers (add/edit/delete/action)
4. Register commands + context menus + inline actions
5. Wire file watcher to tree refresh
6. Write tests
```

### Deliverable
- All 7 sidebar tree views populated and interactive.
- Full CRUD for every domain.
- Commands: copy to clipboard + run in terminal.
- Links: drag-and-drop reorder.
- File watcher connected to all tree refreshes.

---

## 5. Phase 3 — Webviews + Polish (5 days)

### Goal
Complex views that require HTML rendering, plus overall UI polish.

### Tasks

| # | Task | Days |
|---|------|------|
| 3.1 | **Dashboard Webview** — stat cards, today's todos, quick links | 1 |
| 3.2 | **Records Webview** — monthly calendar grid, time entry form, stats | 2 |
| 3.3 | **Webview utility layer** — shared CSS (theme vars), postMessage handler, Nonce CSP | 0.5 |
| 3.4 | **Keybindings** — register all shortcuts (Ctrl+Shift+T/C/D) | 0.25 |
| 3.5 | **Welcome view** — first-run experience: set data directory, create sample data | 0.5 |
| 3.6 | **Error handling** — graceful fallbacks for missing files, corrupt JSON, disk errors | 0.5 |
| 3.7 | **Icon set** — design/acquire Activity Bar icon, tree view icons (dark + light) | 0.25 |

### Webview Architecture

```typescript
// Shared pattern for all webview panels
abstract class ArbeitsplatzWebview {
    protected panel: vscode.WebviewPanel;
    protected disposables: vscode.Disposable[] = [];

    abstract getHtmlContent(): string;
    abstract handleMessage(message: any): void;

    protected postMessage(message: any): void {
        this.panel.webview.postMessage(message);
    }

    protected getWebviewUri(fileName: string): vscode.Uri {
        return this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'webview-ui', fileName)
        );
    }
}
```

### Deliverable
- Dashboard opens with overview stats.
- Records view shows full calendar with add/navigate.
- Polished first-run experience.
- All keybindings documented and working.

---

## 6. Phase 4 — Multi-Instance + Publish (4 days)

### Goal
Safe multi-instance operation and VSIX published to the Marketplace.

### Tasks

| # | Task | Days |
|---|------|------|
| 4.1 | Integrate `proper-lockfile` for all writes | 0.5 |
| 4.2 | File watcher: debounce, self-write filtering, domain-specific events | 0.5 |
| 4.3 | Migration command: copy data from project root to user-space dir | 0.5 |
| 4.4 | End-to-end testing: two Extension Dev Hosts writing concurrently | 0.5 |
| 4.5 | README.md with screenshots, feature list, configuration docs | 0.5 |
| 4.6 | CHANGELOG.md | 0.25 |
| 4.7 | Icon and marketplace metadata (gallery banner, categories, tags) | 0.25 |
| 4.8 | `vsce package` → test VSIX install → fix `.vscodeignore` | 0.25 |
| 4.9 | Publish to VS Code Marketplace (or local VSIX distribution) | 0.25 |

### Deliverable
- Stable VSIX package.
- Safe concurrent operation with lockfiles.
- Published to Marketplace (or distributable VSIX).

---

## 7. Porting Effort per Backend Module

Detailed line-count estimates for porting Python logic to TypeScript:

| Python Module | Python Lines | Est. TS Lines | Complexity | Notes |
|---------------|-------------|---------------|-----------|-------|
| `json_store.py` | 30 | 60 | Low | Add atomic write + lockfile |
| `time_utils.py` | 50 | 60 | Low | Regex patterns translate directly |
| `link_tree.py` | 45 | 50 | Low | Pure recursive functions |
| `tag_propagation.py` | 120 | 140 | Medium | Cross-store walk; needs all file paths |
| `recurring_generation.py` | 150 | 170 | Medium | Schedule matching + idempotency |
| `todo_page.py` | 25 | 30 | Low | Markdown rendering (optional) |
| **Models** (8 files) | ~200 total | ~150 | Low | TS interfaces are terser than Pydantic |
| **Total new data layer** | ~620 | ~660 | — | — |

### Porting Notes

1. **No HTTP layer**: The extension doesn't have routers/endpoints. Command handlers call
   data layer directly. This eliminates ~600 lines of router code.
2. **No Pydantic validation**: VS Code inputs are validated via QuickPick constraints and
   InputBox validators. The models become plain TypeScript interfaces.
3. **Async vs sync**: Python backend is sync I/O; TypeScript extension uses async
   `fs.promises`. All data operations are `async/await`.

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Tree DnD API limitations (links) | Medium | Medium | Fall back to "Move" command via QuickPick if DnD is buggy |
| File watcher reliability (Windows) | Low | High | Use `vscode.workspace.createFileSystemWatcher` (more reliable than raw `fs.watch`) |
| Webview startup latency | Low | Low | Pre-compile webview HTML; lazy-load only when opened |
| JSON corruption on concurrent write | Medium | High | Lockfiles (Phase 4) + atomic writes |
| VS Code API breaking changes | Low | Medium | Pin minimum VS Code version; test on stable channel |
| Large data files (>1MB JSON) | Low | Medium | Stream-parse with `JSONStream` if needed; unlikely for personal data |
| `proper-lockfile` on network drives (OneDrive) | Medium | High | Detect network/cloud drive; warn user; offer local-only mode |

### OneDrive-Specific Risk

Your workspace is on OneDrive. This introduces:
- **Sync conflicts**: OneDrive may create `-conflict` copies of JSON files.
- **Lock file issues**: `.lock` directories may not work reliably on cloud-synced storage.
- **Recommendation**: Store the working data in a local path (e.g., `C:\Users\{user}\.arbeitsplatz`)
  and let OneDrive sync the project source code only. Add data directories to `.gitignore` and
  OneDrive selective sync exclusions.

---

## 9. Milestone Timeline

```
          Week 1          Week 2          Week 3          Week 4
    ┌───────────────┬───────────────┬───────────────┬───────────────┐
    │ Phase 0       │ Phase 1       │ Phase 2       │ Phase 3 + 4   │
    │ Scaffold      │ Data + TODOs  │ All Modules   │ Webviews +    │
    │               │               │               │ Publish       │
    └───────────────┴───────────────┴───────────────┴───────────────┘
    │                                                               │
    Day 1                                                       Day 23
```

---

*Next: [07-TESTING-AND-CI.md](07-TESTING-AND-CI.md) — Testing strategy, CI pipeline, and quality gates.*

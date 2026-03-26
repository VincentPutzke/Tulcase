# Tulcase VS Code Extension — Development Report

## Summary

The **vscode-tulcase** extension (display name: "Tulcase") has been scaffolded, implemented, built, and unit-tested. It replicates the core functionality of the existing Angular + Python web app as a native VS Code extension using tree views, commands, and direct JSON file I/O.

---

## Steps Completed

### 1. Planning & Analysis
- Read all 10 planning documents (`01-PROJECT-OVERVIEW` through `10-SUMMARY`)
- Analyzed the existing Tulcase Python backend — config, services (todos, tags, links, commands, lists, records, recurring), and models
- Created a phased development plan

### 2. Scaffolding
| File | Purpose |
|------|---------|
| `package.json` | Extension manifest: 6 views in Activity Bar, 33 commands, menus, keybindings, devDependencies |
| `tsconfig.json` | TypeScript: CommonJS, ES2022, strict mode |
| `esbuild.mjs` | Bundler: single entry → `out/extension.js`, externals `vscode` |
| `.vscode/launch.json` | "Run Extension" + "Extension Tests" debug configs |
| `.vscode/tasks.json` | npm compile / npm watch tasks |
| `vitest.config.ts` | Test runner: `src/test/**/*.test.ts`, v8 coverage on data + models |
| `.vscodeignore` | Exclude source, tests, node_modules from VSIX |
| `.gitignore` | Standard Node + VS Code extension ignores |
| `media/icon.svg` | Activity Bar icon |

### 3. Models (7 files + index)
All models ported from Python Pydantic to TypeScript interfaces:
- `todo.model.ts` — `TodoItem`, `TodoStore`
- `tag.model.ts` — `TagDef`, `TagStore`, default color/category constants
- `recurring.model.ts` — `RecurringSchedule`, `RecurringAction`, `RecurringStore`
- `command.model.ts` — `CommandEntry`, `CommandStore`
- `link.model.ts` — `LinkNode` (folder/link tree), `LinkStore`
- `list.model.ts` — `ListItem`, `MiniList`, `ListStore`
- `record.model.ts` — `RecordEntry`, `RecordDb`, `RecordIndexEntry`

### 4. Data Layer (5 services + index)
- `json-store.ts` — Async read/write with atomic temp-then-rename, auto-directory creation
- `time-utils.ts` — Time parsing (90, 1.5, 1:30, 1.5h), date formatting, addDays
- `link-tree.ts` — Recursive tree traversal: findNode, removeNode, countLinks
- `tag-propagation.ts` — Cross-store tag operations: stripTagFromAll, renameTagInAll
- `recurring-sync.ts` — Idempotent recurring todo generation (daily/weekly/monthly)

### 5. Infrastructure
- `config.ts` — `TulcaseSettings` interface, `buildSettings()` with platform-specific defaults
- `watchers/file-watcher.ts` — `DataFileWatcher` using `vscode.workspace.createFileSystemWatcher`, domain-specific event emitters, 100ms debounce, self-write filtering
- `utils/id.ts` — `generateId(prefix)` → `prefix_timestamp_random`

### 6. Tree Data Providers (6 files)
- `todo-tree.provider.ts` — Date-bucketed: Overdue / Today / Tomorrow / Upcoming / Done. Toggle done visibility. Stats for status bar.
- `tag-tree.provider.ts` — Grouped by category. Dynamic SVG color circle icons via data URIs.
- `command-tree.provider.ts` — Flat list with legacy string format support.
- `link-tree.provider.ts` — Recursive folder/link tree. URLs in description.
- `list-tree.provider.ts` — Parent (done/total count) → children (checkbox icons).
- `record-tree.provider.ts` — Year → Month hierarchy. Scans `records_db/` directory. Total hours per month.

### 7. Command Handlers (6 files)
- `todo-commands.ts` — add, quickAdd (parses `#tags` and dates from input), markDone/Undone, moveToNextDay, reschedule (Today/Tomorrow/Next Monday/Custom), edit, delete
- `tag-commands.ts` — add (name → color picker → category), rename (cross-store propagation), changeColor, delete (cross-store strip)
- `command-commands.ts` — add, copy to clipboard, run in terminal, edit, delete
- `link-commands.ts` — addLink, addFolder, open (external browser), copyUrl, edit, delete
- `list-commands.ts` — addList, addItem, toggleItem, editList, editItem, deleteList, deleteItem
- `record-commands.ts` — addRecord with date/time/notes prompts, time parsing, writes to `records_db/{year}/{month}.json`

### 8. Views & Entry Point
- `views/status-bar.ts` — `StatusBar` showing "$(checklist) X todos · Y overdue", click focuses todos view
- `extension.ts` — Main activate/deactivate. Wires providers, commands, status bar, file watcher. Runs recurring sync on activation.

### 9. Unit Tests (5 test suites, 49 tests)
- `json-store.test.ts` — Read/write, missing files, corrupt JSON, auto-directory creation
- `time-utils.test.ts` — All time formats, date operations, edge cases
- `link-tree.test.ts` — Find/remove/count in nested tree structures
- `tag-propagation.test.ts` — Strip & rename across all stores (todos, recurring, commands, links, lists)
- `recurring-sync.test.ts` — Daily/weekly/monthly schedules, idempotency, inactive skip, lastCreatedDate

### 10. Build Verification
- `npm install` — 410 packages installed
- `npm run compile` (esbuild) — Build complete, 60KB bundled output
- `npx tsc --noEmit` — Zero type errors
- `npm test` (vitest) — **49/49 tests pass**

---

## Bugs Fixed During Development

1. **esbuild.mjs used `require()` in ESM file** — Changed to `import esbuild from 'esbuild'`
2. **TypeScript type assertion error in recurring-sync.ts** — Added `unknown` intermediate cast for `RecurringSchedule` → `Record<string, unknown>`
3. **Test import paths off by one level** — Fixed `../../data/` → `../data/` (tests are in `src/test/`, not `src/test/data/`)

---

## How to Run

### Build
```bash
cd Tulcase
npm install
npm run compile
```

### Test
```bash
npm test
```

### Launch in VS Code
Press **F5** with the Tulcase folder active, or use the **"Run Extension"** debug configuration. This opens a new Extension Development Host window with the Tulcase sidebar visible.

### Data Directory
By default, the extension stores data in:
- **Windows**: `%APPDATA%\tulcase\`
- **macOS**: `~/Library/Application Support/tulcase/`
- **Linux**: `~/.local/share/tulcase/`

Override via setting: `tulcase.dataDirectory`

---

## Open Questions for You

1. **Data directory**: Should the extension default to the same directory as the existing Tulcase web app? Currently the Python backend uses `*_db/` folders relative to the project root. The extension uses a platform-specific user directory. Do you want them to share the same data?

2. **Tag color presets**: I defined 10 preset colors in the tag color picker. Do you want these to match the exact colors from the Angular frontend?

3. **Records display**: The current tree view shows Year → Month with total hours. The planning docs mention a calendar webview (Phase 3). Any priority on this?

4. **Dashboard webview**: This is a Phase 3 feature (currently shows a placeholder message). What widgets/content do you want on the dashboard?

5. **Recurring schedule UI**: The current add/edit flow collects info through VS Code quick picks. The Python backend has fields like `weekdays`, `weeks`, `type`. Should I support editing that inline or add a webview form?

6. **Extension icon**: I created a simple SVG placeholder. Do you have a preferred icon or brand design?

7. **Publishing**: The `publisher` field is set to `"codewerk"`. Is this the correct VS Code Marketplace publisher name? Do you plan to publish publicly or use it privately?

8. **Import from web app**: Should there be a one-time import command that reads data from the existing Tulcase web app's `*_db/` directories and copies it to the extension's data directory?

---

## Tasks Still Open

### Phase 2 (polish)
- [ ] ESLint + Prettier configuration files
- [ ] README.md with feature overview & screenshots
- [ ] CHANGELOG.md

### Phase 3 (webviews)
- [ ] Dashboard webview panel
- [ ] Records calendar webview (monthly view with day cells)
- [ ] Webview utility library (CSP nonces, theme-aware CSS)

### Phase 4 (production)
- [ ] E2E tests using `@vscode/test-electron`
- [ ] CI/CD pipeline
- [ ] VSIX packaging and Marketplace publishing
- [ ] Multi-root workspace support (per-folder data directories)
- [ ] Data migration / import from existing web app

### Nice-to-haves
- [ ] Drag & drop reordering in link tree
- [ ] Export to Markdown (todos, lists)
- [ ] Keyboard navigation improvements
- [ ] Notes/Markdown editing integration
- [ ] Todo index-based addressing (P3 from planning docs)

---

## File Structure

```
Tulcase/
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── media/
│   └── icon.svg
├── out/
│   └── extension.js          (bundled output)
├── src/
│   ├── extension.ts           (entry point)
│   ├── config.ts              (settings resolution)
│   ├── commands/
│   │   ├── command-commands.ts
│   │   ├── link-commands.ts
│   │   ├── list-commands.ts
│   │   ├── record-commands.ts
│   │   ├── tag-commands.ts
│   │   └── todo-commands.ts
│   ├── data/
│   │   ├── index.ts
│   │   ├── json-store.ts
│   │   ├── link-tree.ts
│   │   ├── recurring-sync.ts
│   │   ├── tag-propagation.ts
│   │   └── time-utils.ts
│   ├── models/
│   │   ├── index.ts
│   │   ├── command.model.ts
│   │   ├── link.model.ts
│   │   ├── list.model.ts
│   │   ├── record.model.ts
│   │   ├── recurring.model.ts
│   │   ├── tag.model.ts
│   │   └── todo.model.ts
│   ├── providers/
│   │   ├── command-tree.provider.ts
│   │   ├── link-tree.provider.ts
│   │   ├── list-tree.provider.ts
│   │   ├── record-tree.provider.ts
│   │   ├── tag-tree.provider.ts
│   │   └── todo-tree.provider.ts
│   ├── test/
│   │   ├── json-store.test.ts
│   │   ├── link-tree.test.ts
│   │   ├── recurring-sync.test.ts
│   │   ├── tag-propagation.test.ts
│   │   └── time-utils.test.ts
│   ├── utils/
│   │   └── id.ts
│   ├── views/
│   │   └── status-bar.ts
│   └── watchers/
│       └── file-watcher.ts
├── .gitignore
├── .vscodeignore
├── esbuild.mjs
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

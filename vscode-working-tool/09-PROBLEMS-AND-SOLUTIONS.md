# 09 — Known Problems & Solutions

> Anticipated challenges, edge cases, and proven resolution strategies for the
> Arbeitsplatz VS Code extension project.

---

## 1. Problem Registry

| # | Problem | Severity | Phase | Status |
|---|---------|----------|-------|--------|
| P1 | Concurrent writes corrupt JSON files | High | 4 | Solved (lockfiles) |
| P2 | File watcher reliability on Windows / OneDrive | High | 2 | Solved (VS Code API) |
| P3 | Todo index-based addressing is fragile | Medium | 1 | Solved (migrate to ID) |
| P4 | Webview Content Security Policy | Medium | 3 | Solved (nonce-based CSP) |
| P5 | Tree view doesn't support rich forms | Medium | 1-2 | Solved (QuickPick + Webview) |
| P6 | Tag color rendering in tree views | Low | 2 | Solved (dynamic SVG) |
| P7 | Drag-and-drop across tree view sections | Medium | 2 | Solved (TreeDnD API) |
| P8 | Large JSON files (performance) | Low | Future | Mitigated |
| P9 | OneDrive / cloud drive sync conflicts | High | 1 | Mitigated (recommendation) |
| P10 | Extension activation time | Low | 0 | Solved (lazy activation) |
| P11 | Cross-platform path handling | Medium | 0 | Solved (path.join()) |
| P12 | Webview state persistence | Medium | 3 | Solved (webview serializer) |
| P13 | Recurring sync timing | Low | 1 | Solved (on-activation + interval) |
| P14 | Python server and extension write conflicts | Medium | 4 | Mitigated |

---

## 2. Detailed Analysis

### P1: Concurrent Writes Corrupt JSON Files

**Problem**: Two VS Code windows (or Python server + extension) write to the same JSON
file simultaneously. Last write wins; first write's changes are lost.

**Why it matters**: Data loss in a productivity tool erodes trust instantly.

**Solution (Progressive)**:

1. **Phase 1 — Atomic writes**: Write to `{file}.tmp`, then rename. Prevents partial writes
   from corrupting the file. Cost: zero dependencies.

2. **Phase 4 — Lockfiles**: Use `proper-lockfile` to acquire an exclusive lock before writing:
    ```typescript
    const release = await lockfile.lock(filePath, {
        retries: { retries: 3, minTimeout: 100, maxTimeout: 500 },
        stale: 5000  // auto-release after 5s (crash recovery)
    });
    try {
        const current = await readJson(filePath);
        // Apply changes to current state (not stale snapshot)
        await writeJson(filePath, updated);
    } finally {
        await release();
    }
    ```

3. **Future — Versioned writes**: Add `_version` counter to each JSON root. On write, compare
   version. On conflict, re-read and re-apply. Clean but requires schema change.

**Residual risk**: The Python server won't use lockfiles unless updated. Mitigation: the
file watcher detects Python-written changes and refreshes the extension's in-memory state.

---

### P2: File Watcher Reliability

**Problem**: Node.js `fs.watch` is notoriously unreliable across platforms (double-fires
on macOS, missing events on Windows, inode recycling on Linux).

**Solution**: Use `vscode.workspace.createFileSystemWatcher()` instead of raw `fs.watch`.
VS Code's implementation:
- Uses OS-native watchers (inotify, FSEvents, ReadDirectoryChangesW).
- Handles platform quirks internally.
- Integrates with VS Code's event loop (no separate thread management).
- Supports glob patterns.

```typescript
const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(dataDir, '**/*.json')
);
watcher.onDidChange(uri => handleFileChange(uri));
watcher.onDidCreate(uri => handleFileChange(uri));
watcher.onDidDelete(uri => handleFileChange(uri));
context.subscriptions.push(watcher);
```

**Debouncing**: Wrap in a 100ms debounce per file to batch rapid events:
```typescript
const pending = new Map<string, NodeJS.Timeout>();

function handleFileChange(uri: vscode.Uri) {
    const key = uri.fsPath;
    if (pending.has(key)) clearTimeout(pending.get(key)!);
    pending.set(key, setTimeout(() => {
        pending.delete(key);
        refreshDomain(key);
    }, 100));
}
```

---

### P3: Todo Index-Based Addressing is Fragile

**Problem**: The current API uses array indices to identify todos (`PUT /api/todos/3`).
If the array changes between GET and PUT (e.g., another client deletes an item), the
wrong todo gets modified.

**Solution**: Introduce a unique `id` field on each todo item:

```json
{ "id": "td_1710590400000", "note": "Buy milk", "date": "2026-03-16", "done": false, "tags": [] }
```

**Migration**:
1. On first read, if any todo lacks an `id`, generate one: `td_{timestamp}_{index}`.
2. Write the migrated data back.
3. All extension operations use `id` instead of index.
4. The Python server continues using indices (it doesn't need to change for the prototype;
   update later for consistency).

**Impact**: The JSON schema gains a new field. The Python server ignores unknown fields,
so backward compatibility is maintained.

---

### P4: Webview Content Security Policy

**Problem**: Webviews run in a sandboxed iframe. Without a CSP, they could load external
resources (security risk). With a too-strict CSP, the UI breaks.

**Solution**: Use a nonce-based CSP:

```typescript
function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'webview-ui', 'styles.css')
    );
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'webview-ui', 'main.js')
    );

    return `<!DOCTYPE html>
    <html>
    <head>
        <meta http-equiv="Content-Security-Policy" content="
            default-src 'none';
            style-src ${webview.cspSource} 'nonce-${nonce}';
            script-src 'nonce-${nonce}';
            img-src ${webview.cspSource} https:;
            font-src ${webview.cspSource};
        ">
        <link href="${styleUri}" rel="stylesheet">
    </head>
    <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}

function getNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}
```

---

### P5: Tree View Doesn't Support Rich Forms

**Problem**: VS Code tree views render flat text items with optional icons and descriptions.
They cannot render forms, calendars, or complex layouts.

**Solution**: Dual-mode interaction:

1. **Quick actions** (most common): Use QuickPick / InputBox sequences for simple operations
   (add, rename, move). These are fast, keyboard-friendly, and native to VS Code.

2. **Complex views** (when needed): Open a webview panel for calendar, dashboard, or
   detailed editing forms. The webview communicates with the extension host via
   `postMessage`.

**Guideline**: Prefer QuickPick for actions that need ≤3 inputs. Use webview for anything
with >3 inputs, visual layouts, or drag-and-drop.

---

### P6: Tag Color Rendering in Tree Views

**Problem**: Tree view items use `ThemeIcon` (codicons) or `Uri`-based icons. There's no
built-in way to show a colored circle matching a tag's custom color.

**Solution**: Generate SVG data URIs dynamically:

```typescript
function colorCircleIcon(hexColor: string): vscode.Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" fill="${hexColor}"/>
    </svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

// Usage in TreeItem:
treeItem.iconPath = colorCircleIcon('#7c6aff');
```

**Alternative**: Pre-generate a set of ~20 color icon files in `media/colors/` and pick
the closest match. Simpler but less flexible.

**Note**: Data URIs may not work in all VS Code versions for tree item icons. If not,
fall back to pre-generated files or use `ThemeIcon` with `ThemeColor`.

---

### P7: Drag-and-Drop in Tree Views

**Problem**: The links tree needs drag-and-drop to reorder items and move between folders.
VS Code's TreeView DnD API (since 1.66) supports this but has constraints.

**Solution**: Implement `vscode.TreeDragAndDropController<LinkNode>`:

```typescript
class LinkDragAndDropController implements vscode.TreeDragAndDropController<LinkNode> {
    dropMimeTypes = ['application/vnd.code.tree.arbeitsplatz.links'];
    dragMimeTypes = ['application/vnd.code.tree.arbeitsplatz.links'];

    handleDrag(source: readonly LinkNode[], dataTransfer: vscode.DataTransfer): void {
        dataTransfer.set(
            'application/vnd.code.tree.arbeitsplatz.links',
            new vscode.DataTransferItem(source)
        );
    }

    async handleDrop(target: LinkNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const items = dataTransfer.get('application/vnd.code.tree.arbeitsplatz.links');
        if (!items) return;
        const sources = items.value as LinkNode[];

        for (const source of sources) {
            await this.moveNode(source.id, target?.id);
        }
    }
}
```

**Limitations**:
- DnD between different tree views is not supported (can't drag a link to the todos tree).
- Drop position (before/after/into) requires careful handling of the `target` parameter.
- Some VS Code versions have DnD bugs; minimum version should be 1.74+.

**Fallback**: If DnD proves unreliable, provide a "Move to..." context menu that opens a
QuickPick listing all folders.

---

### P8: Large JSON Files (Performance)

**Problem**: A user with 10,000+ bookmarks or years of records could have JSON files >1MB.
Parsing and writing could become slow.

**Current state**: Unlikely for personal use (most users will have <1000 items total).

**Mitigation**:
- Use `JSON.parse()` / `JSON.stringify()` — V8's native JSON parser is fast (~10ms for 1MB).
- Only read files when needed (lazy loading per domain).
- Cache the parsed result; invalidate on file watcher event.
- If this ever becomes a problem, consider streaming JSON parsing or splitting into
  multiple files per month/category.

---

### P9: OneDrive / Cloud Drive Sync Conflicts

**Problem**: The workspace lives on OneDrive. When two machines edit the same JSON files
while offline, OneDrive creates conflict copies (e.g., `todos-MachineName.json`).

**Solution (Recommendation)**:

1. **Primary recommendation**: Store the `*_db/` data in a local directory that is NOT
   synced by OneDrive. Use `C:\Users\{user}\.arbeitsplatz` on Windows.

2. **If cloud sync is desired**: Use a dedicated sync tool like Syncthing (designed for
   conflict resolution) instead of OneDrive, and configure it to resolve conflicts
   automatically with last-write-wins.

3. **Detection**: The extension can detect `*-conflict*` files in the data directory and
   show a warning: "Sync conflicts detected. Please resolve manually."

---

### P10: Extension Activation Time

**Problem**: Extensions that do heavy work in `activate()` delay VS Code startup.

**Solution**:
- Use lazy activation events (`onView:`, `onCommand:`) — the extension never loads until
  the user explicitly interacts with it.
- `activate()` does minimal work: resolve settings → register commands → register providers.
  No file I/O in `activate()`.
- Tree data is loaded lazily in `getChildren()` — only when the tree view becomes visible.
- Recurring sync runs as a deferred `setTimeout(() => syncRecurring(), 500)`.

---

### P11: Cross-Platform Path Handling

**Problem**: Windows uses `\`, Linux/macOS use `/`. Path construction with string
concatenation breaks cross-platform.

**Solution**: Always use `path.join()` and `path.resolve()`:

```typescript
// ✅ Correct
const todosFile = path.join(baseDir, 'todo_db', 'todos.json');

// ❌ Wrong
const todosFile = `${baseDir}/todo_db/todos.json`;
```

For VS Code URIs, use `vscode.Uri.joinPath()`:
```typescript
const webviewUri = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'main.js');
```

---

### P12: Webview State Persistence

**Problem**: When the user switches away from a webview tab and comes back, the webview's
HTML is disposed and recreated (to save memory). Any unsaved form state is lost.

**Solution**: Implement `WebviewPanelSerializer`:

```typescript
class DashboardSerializer implements vscode.WebviewPanelSerializer {
    async deserializeWebviewPanel(
        webviewPanel: vscode.WebviewPanel,
        state: any
    ): Promise<void> {
        // Restore the webview from saved state
        webviewPanel.webview.html = getHtmlContent();
        webviewPanel.webview.postMessage({ type: 'restore', data: state });
    }
}

// Register in activate():
vscode.window.registerWebviewPanelSerializer('arbeitsplatz.dashboard', new DashboardSerializer());
```

Also use `retainContextWhenHidden: true` for webviews that should keep state when hidden
(at the cost of memory):
```typescript
const panel = vscode.window.createWebviewPanel(
    'arbeitsplatz.records',
    'Records',
    vscode.ViewColumn.One,
    { retainContextWhenHidden: true }
);
```

---

### P13: Recurring Sync Timing

**Problem**: Recurring todos should be generated at the start of each day. But the extension
might not be active at midnight; on the other hand, activating at 09:00 should generate
today's recurring todos.

**Solution**: The recurring sync is **date-based, not time-based** (matching the Python
implementation). It runs:

1. **On activation**: Generate any due recurring todos. Idempotent — safe to call multiple times.
2. **Hourly check**: A `setInterval` runs `syncRecurring()` every 60 minutes. If the date
   has rolled over (midnight boundary), new todos are generated.
3. **On manual refresh**: "Arbeitsplatz: Refresh All" triggers sync.

Since `lastCreatedDate` is stored per action, duplicate generation is impossible.

---

### P14: Python Server and Extension Write Conflicts

**Problem**: If the user runs both the web app (Python server) and the extension, both
write to the same files. The Python server won't use lockfiles.

**Solution (Progressive)**:

1. **Prototype**: Accept that conflicts are rare in single-user use. File watcher detects
   Python writes and refreshes the extension. Data is eventually consistent.

2. **v1.0**: Add `filelock` to the Python server's `json_store.py`:
    ```python
    from filelock import FileLock

    def write_json(path: Path, data: dict) -> None:
        lock = FileLock(str(path) + ".lock", timeout=5)
        with lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    ```
    This is a 4-line change to the existing Python codebase.

3. **Future**: Use a shared lock protocol (both sides use `.lock` files in the same format).

---

## 3. Edge Cases Checklist

| # | Edge Case | Expected Behavior |
|---|-----------|------------------|
| EC-1 | Data directory doesn't exist on activation | Create it with empty JSON stores |
| EC-2 | JSON file contains invalid JSON | Show error notification; use fallback empty data |
| EC-3 | File is locked by another process | Retry 3x with 200ms delay; show error if all fail |
| EC-4 | User deletes data directory while extension is running | File watcher detects; recreate directory on next write |
| EC-5 | User changes `dataDirectory` setting | Re-initialize all providers; stop old watchers; start new ones |
| EC-6 | Extremely long todo note (>10,000 chars) | Truncate display in tree view; full text in webview |
| EC-7 | Todo with date in the far past (< year 2000) | Show in "Overdue" bucket; no special handling |
| EC-8 | Todo with date in the far future (> year 2100) | Show in "Later" bucket |
| EC-9 | Circular folder structure in links | Shouldn't happen (IDs are unique); guard with depth limit |
| EC-10 | Two tags with same name different case | Tag names are case-sensitive (match Python behavior) |
| EC-11 | Commands with special characters in label | URL-encode in file operations (same as Python `unquote`) |
| EC-12 | Records for month 00 or 13 | Validate month in command handler; reject invalid |
| EC-13 | Empty data files (0 bytes) | `readJson` returns default value |
| EC-14 | Extension update overwrites user data | Data is outside extension dir; update cannot affect it |

---

*Next: [10-SUMMARY.md](10-SUMMARY.md) — Executive summary with navigation links to all documents.*

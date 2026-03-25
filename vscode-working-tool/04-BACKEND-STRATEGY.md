# 04 — Shared Backend & Multi-Instance Strategy

> How the VS Code extension and the existing web application share the same data,
> and how multiple VS Code windows can safely read/write concurrently.

---

## 1. The Core Challenge

Today the data lives in `*_db/` directories at the project root. The Python server reads
and writes those files with zero concurrency control (`json_store.py` has no locks).
This works because:

1. There is exactly one server process.
2. FastAPI handles requests sequentially per worker (the default single-worker uvicorn).

With the VS Code extension, we introduce **multiple writers**:

| Writer | How it writes | When |
|--------|--------------|------|
| Python server | `json_store.write_json()` | On any API mutation |
| VS Code window 1 | `fs.writeFile()` + rename | On any extension command |
| VS Code window 2 | `fs.writeFile()` + rename | On any extension command |

Without protection, two concurrent writes will cause last-write-wins data loss.

---

## 2. Data Directory Location

### Current State
Set via `ARBEITSPLATZ_BASE_DIR` env var, defaulting to the project root.

### Target State (Extension)
A system-wide user-space directory that all clients share:

| Platform | Default Path |
|----------|-------------|
| Windows  | `%APPDATA%\arbeitsplatz\` |
| macOS    | `~/Library/Application Support/arbeitsplatz/` |
| Linux    | `~/.local/share/arbeitsplatz/` |

Configurable via `arbeitsplatz.dataDirectory` in VS Code settings.

### Migration Path

1. **Phase 1 (Prototype)**: The extension uses whatever directory the user points it at.
   If they point it at the existing project root, it shares data with the web app instantly.
2. **Phase 2 (User-space)**: Default to the platform-specific user directory. Provide a
   one-time migration command: `Arbeitsplatz: Migrate Data to User Directory` that
   copies `*_db/` + `notes/` to the new location.
3. **Phase 3 (Python server config)**: Update the Python server to also default to the
   user-space directory (or read the same VS Code setting via a shared config file).

---

## 3. Concurrency Strategy — Progressive Approach

### Level 1: Single-Window (v0.1 — Prototype)

**No concurrency control.** Direct `fs.readFile` / `fs.writeFile` with atomic rename.
This matches the current Python behavior. Acceptable because:
- 99% of users will use one VS Code window at a time.
- Even if two windows race, the JSON structures are simple and the worst case is one
  write overwriting another (annoying but not destructive).

### Level 2: File Watcher Refresh (v0.2)

Add `fs.watch` on all `*_db/` directories. When a file changes (from any source), the
extension reloads that domain's data and refreshes all views.

**Benefit**: If the Python server or another window writes a file, the current window
sees the change within ~100ms.

**Does NOT solve**: Two writes at the exact same millisecond.

### Level 3: Lockfile-Based Mutual Exclusion (v1.0)

Use the `proper-lockfile` npm package (or equivalent):

```typescript
import lockfile from 'proper-lockfile';

async function safeWrite(filePath: string, data: unknown): Promise<void> {
    const release = await lockfile.lock(filePath, { retries: 3, stale: 5000 });
    try {
        // Read current state (in case it changed while waiting for lock)
        const current = await readJson(filePath);
        // Apply mutation
        const merged = applyChanges(current, data);
        // Write atomically (temp file + rename)
        const tmpPath = filePath + '.tmp';
        await fs.writeFile(tmpPath, JSON.stringify(merged, null, 2), 'utf-8');
        await fs.rename(tmpPath, filePath);
    } finally {
        await release();
    }
}
```

**How it works**:
- `proper-lockfile` creates a `.lock` directory next to the file.
- Retry with backoff if locked; stale timeout (5s) auto-releases stuck locks.
- All writers (extension instances) compete for the lock; only one writes at a time.

**Limitation**: The Python server does NOT acquire locks by default. We'll need to either:
- (a) Add lockfile support to `json_store.py` (simple, ~10 lines with `filelock` package), or
- (b) Accept that the Python server is a "rogue writer" and rely on the file watcher to
  detect and reload after Python writes.

Option (a) is recommended for production; option (b) is fine for the prototype.

### Level 4: Optimistic Concurrency with Versioning (Future)

Add a `_version: number` field to each JSON root:

```json
{
  "_version": 42,
  "items": [ ... ]
}
```

On write:
1. Read current version from file.
2. If file's version ≠ expected version → conflict (another writer got in first).
3. On conflict: re-read, re-apply the user's change, increment version, write.

This is the cleanest approach but requires schema changes. Defer to v2.

---

## 4. Atomic Write Strategy

Replace the naive `fs.writeFile` with a two-step atomic pattern:

```
1. Write data to {file}.tmp  (same directory, so same filesystem)
2. Rename {file}.tmp → {file}  (atomic on all major OS)
```

On Windows, `fs.rename` is not always atomic if the target exists. Workaround:

```typescript
// Windows-safe atomic write
async function atomicWrite(filePath: string, data: string): Promise<void> {
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, data, 'utf-8');
    try {
        await fs.rename(tmpPath, filePath);
    } catch {
        // Windows: target exists and rename fails → delete then rename
        await fs.unlink(filePath);
        await fs.rename(tmpPath, filePath);
    }
}
```

---

## 5. File Watcher Design

```typescript
class DataFileWatcher implements vscode.Disposable {
    private watchers: fs.FSWatcher[] = [];
    private selfWriteTimestamps = new Map<string, number>();

    // Events
    readonly onTodosChanged = new vscode.EventEmitter<void>();
    readonly onTagsChanged = new vscode.EventEmitter<void>();
    readonly onCommandsChanged = new vscode.EventEmitter<void>();
    readonly onLinksChanged = new vscode.EventEmitter<void>();
    readonly onListsChanged = new vscode.EventEmitter<void>();
    readonly onRecordsChanged = new vscode.EventEmitter<void>();

    constructor(private settings: ArbeitsplatzSettings) {
        this.watchAll();
    }

    markSelfWrite(filePath: string): void {
        // Record that WE wrote this file, so the watcher can ignore it
        this.selfWriteTimestamps.set(filePath, Date.now());
    }

    private isSelfWrite(filePath: string): boolean {
        const ts = this.selfWriteTimestamps.get(filePath);
        if (!ts) return false;
        // If we wrote it less than 500ms ago, it's our write
        if (Date.now() - ts < 500) return true;
        this.selfWriteTimestamps.delete(filePath);
        return false;
    }
}
```

**Debouncing**: Multiple rapid file events (common on some OS/editors) are debounced to
a single refresh per 100ms window.

---

## 6. Shared Config File

To keep the Python server and VS Code extension in sync on the data directory, introduce
a shared config file:

```
~/.arbeitsplatz/config.json
{
    "dataDirectory": "~/.arbeitsplatz",
    "version": "1.0.0"
}
```

Both clients read this file on startup. The VS Code extension writes it when the user
changes the setting; the Python server reads it as a fallback when `ARBEITSPLATZ_BASE_DIR`
is not set.

---

## 7. Architecture Decision Records

### ADR-1: Direct File I/O vs. Keep Python Server

**Decision**: Direct file I/O.  
**Rationale**: Eliminates Python runtime dependency, process management, port conflicts.
The JSON format is simple enough for direct access. Multi-instance safety is handled via
lockfiles and file watchers.

### ADR-2: User-Space Data Directory

**Decision**: Default to platform-specific user directory.  
**Rationale**: System-wide data directory is the only way to share data between multiple
VS Code workspaces/windows without workspace-specific config. Also makes the data portable
and easy to back up.

### ADR-3: Lockfile Library

**Decision**: Use `proper-lockfile` npm package.  
**Rationale**: Well-maintained, cross-platform, handles stale locks. Alternative: `fs-ext`
(native flock) — more robust but requires native compilation.

### ADR-4: Eventual Consistency is Acceptable

**Decision**: Accept that concurrent reads may be briefly stale.  
**Rationale**: The time window for stale reads is <100ms (file watcher debounce). For a
single-user productivity tool, this is imperceptible.

---

## 8. Python Server Coexistence

The existing Python FastAPI server and the VS Code extension can coexist:

```
Scenario 1: User runs ONLY the VS Code extension
  → Extension reads/writes JSON files directly
  → Python server is not started
  → ✅ Works

Scenario 2: User runs BOTH the web app and the extension
  → Python server writes files via json_store.py
  → Extension writes files via JsonStore
  → File watcher detects changes from either side
  → Both UIs refresh within ~100ms
  → ✅ Works (with lockfile protection in v1.0)

Scenario 3: Two VS Code windows with the extension
  → Both read/write the same JSON files
  → Lockfiles prevent write races
  → File watchers refresh both windows
  → ✅ Works
```

---

## 9. Implementation Phases

| Phase | Milestone | Concurrency Model |
|-------|-----------|-------------------|
| v0.1 Prototype | Single-window, direct I/O | None (last-write-wins) |
| v0.2 Watchers | File watcher + refresh | Detect-and-reload |
| v1.0 Stable | Lockfiles + atomic writes | Mutual exclusion |
| v2.0 Versioned | `_version` field in JSON | Optimistic concurrency |

---

*Next: [05-UI-UX-MAPPING.md](05-UI-UX-MAPPING.md) — How each web UI feature maps to VS Code UI primitives.*

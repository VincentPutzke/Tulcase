import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Sub-folder under rootDir that holds all named databases. */
export const DATABASES_ROOT = 'data';

/** Name of the database created on first launch. */
export const DEFAULT_DB = 'default';

/** File (inside rootDir) that stores the active database name. */
const ACTIVE_DB_FILE = '.active-database';

/** File (inside each db dir) that stores the last update/import timestamp. */
const LAST_UPDATED_FILE = '.last-updated';

/** Directories and seed data for an empty database. */
const EMPTY_DB_STORES: Record<string, string> = {
    [path.join('todo_db', 'todos.json')]:     '{"items":[]}',
    [path.join('todo_db', 'recurring.json')]: '[]',
    [path.join('tags_db', 'tags.json')]:      '{"tags":{}}',
    [path.join('commands_db', 'commands.json')]: '{"items":[]}',
    [path.join('links_db', 'links.json')]:    '{"root":[]}',
    [path.join('lists_db', 'lists.json')]:    '{"notes":[],"folders":[]}',
    [path.join('pipe_db', 'scopes.json')]:    '{"scopes":[],"logRules":[]}',
    [path.join('notes', 'todos.md')]:         '',
};

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Resolved file-system paths for all Tulcase data stores.
 *
 * - `rootDir`  — top-level Tulcase directory (platform default or user-configured).
 * - `activeDb` — name of the currently active database.
 * - `baseDir`  — `{rootDir}/data/{activeDb}/` — all providers read/write here.
 */
export interface TulcaseSettings {
    rootDir: string;
    activeDb: string;
    baseDir: string;
    todosFile: string;
    tagsFile: string;
    recurringFile: string;
    commandsFile: string;
    linksFile: string;
    listsFile: string;
    recordsDir: string;
    todoPage: string;
    pipeScopesFile: string;
}

// ── Root directory resolution ──────────────────────────────────────────────────

/**
 * Resolve the top-level Tulcase data directory from VS Code settings or
 * platform default.
 */
function resolveRootDir(): string {
    const config = vscode.workspace.getConfiguration('tulcase');
    const configured = config.get<string>('dataDirectory', '').trim();

    if (configured) {
        if (configured.startsWith('~')) {
            return path.join(os.homedir(), configured.slice(1));
        }
        return configured;
    }

    if (process.platform === 'win32') {
        return path.join(
            process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming'),
            'tulcase',
        );
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'tulcase');
    }
    return path.join(os.homedir(), '.local', 'share', 'tulcase');
}

// ── Active database persistence ────────────────────────────────────────────────

/** Read the active database name from the marker file (falls back to DEFAULT_DB). */
export function readActiveDb(rootDir: string): string {
    try {
        const name = fs.readFileSync(path.join(rootDir, ACTIVE_DB_FILE), 'utf-8').trim();
        return name || DEFAULT_DB;
    } catch {
        return DEFAULT_DB;
    }
}

/** Persist the active database name to the marker file. */
export function writeActiveDb(rootDir: string, name: string): void {
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, ACTIVE_DB_FILE), name, 'utf-8');
}

// ── Database directory helpers ─────────────────────────────────────────────────

/**
 * Create an empty database directory with seed JSON files.
 * Skips files that already exist so the function is idempotent.
 */
export function ensureDatabase(dbDir: string): void {
    for (const [rel, content] of Object.entries(EMPTY_DB_STORES)) {
        const target = path.join(dbDir, rel);
        if (!fs.existsSync(target)) {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content, 'utf-8');
        }
    }
    // Ensure records_db exists (no seed data — it fills over time)
    fs.mkdirSync(path.join(dbDir, 'records_db'), { recursive: true });
}

/**
 * One-time initialisation called at extension activation.
 *
 * - Migrates legacy flat-layout data into `data/default/` if necessary.
 * - Ensures the "default" database exists.
 * - Writes the `.active-database` marker.
 */
export function ensureInitialized(rootDir: string): void {
    const dataDir = path.join(rootDir, DATABASES_ROOT);
    const defaultDir = path.join(dataDir, DEFAULT_DB);

    if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length > 0) {
        return; // Already initialised
    }

    // Check for legacy flat-layout data (todo_db/, tags_db/, etc. under rootDir)
    const legacyDirs = ['todo_db', 'tags_db', 'commands_db', 'links_db', 'lists_db', 'records_db', 'notes'];
    const hasLegacy = legacyDirs.some(d => fs.existsSync(path.join(rootDir, d)));

    if (hasLegacy) {
        fs.mkdirSync(defaultDir, { recursive: true });
        for (const d of legacyDirs) {
            const src = path.join(rootDir, d);
            if (fs.existsSync(src)) {
                fs.cpSync(src, path.join(defaultDir, d), { recursive: true });
            }
        }
    }

    // Guarantee seed files exist (idempotent after migration)
    ensureDatabase(defaultDir);
    writeActiveDb(rootDir, DEFAULT_DB);
}

// ── Settings construction & mutation ───────────────────────────────────────────

/** Compute all derived paths from a rootDir + database name. */
function derivePaths(rootDir: string, dbName: string) {
    const base = path.join(rootDir, DATABASES_ROOT, dbName);
    return {
        rootDir,
        activeDb: dbName,
        baseDir:       base,
        todosFile:     path.join(base, 'todo_db', 'todos.json'),
        tagsFile:      path.join(base, 'tags_db', 'tags.json'),
        recurringFile: path.join(base, 'todo_db', 'recurring.json'),
        commandsFile:  path.join(base, 'commands_db', 'commands.json'),
        linksFile:     path.join(base, 'links_db', 'links.json'),
        listsFile:     path.join(base, 'lists_db', 'lists.json'),
        recordsDir:    path.join(base, 'records_db'),
        todoPage:      path.join(base, 'notes', 'todos.md'),
        pipeScopesFile: path.join(base, 'pipe_db', 'scopes.json'),
    };
}

/**
 * Build a complete `TulcaseSettings` object.
 *
 * @param rootDir  — override for the top-level Tulcase directory (tests).
 * @param dbName   — override for the active database name (tests / switch).
 */
export function buildSettings(rootDir?: string, dbName?: string): TulcaseSettings {
    const root = rootDir || resolveRootDir();
    const active = dbName || readActiveDb(root);
    return derivePaths(root, active);
}

/**
 * Mutate an existing settings object **in-place** so it points to a different
 * database.  Because all providers share the same object reference, this switch
 * takes effect globally the moment `refreshAll()` is called.
 */
export function switchSettingsTo(settings: TulcaseSettings, dbName: string): void {
    const fresh = derivePaths(settings.rootDir, dbName);
    Object.assign(settings, fresh);
    ensureDatabase(settings.baseDir);
    writeActiveDb(settings.rootDir, dbName);
}

// ── Last-updated tracking ──────────────────────────────────────────────────────

/** Read the last-updated ISO timestamp for a database directory. Returns undefined if none. */
export function readLastUpdated(dbDir: string): string | undefined {
    try {
        return fs.readFileSync(path.join(dbDir, LAST_UPDATED_FILE), 'utf-8').trim() || undefined;
    } catch {
        return undefined;
    }
}

/** Write the current timestamp as the last-updated marker. */
export function writeLastUpdated(dbDir: string): void {
    fs.writeFileSync(path.join(dbDir, LAST_UPDATED_FILE), new Date().toISOString(), 'utf-8');
}

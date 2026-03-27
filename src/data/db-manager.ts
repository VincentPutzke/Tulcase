/**
 * Database management layer for Tulcase.
 *
 * A "database" is a named snapshot of all Tulcase data stores (todos, tags,
 * commands, links, notes, records, recurring, todo-page).  Snapshots are
 * persisted as sub-folders under `{baseDir}/_databases/{name}/`, each
 * mirroring the normal Tulcase directory layout.
 *
 * The module exposes four high-level operations consumed by the palette
 * commands in `db-commands.ts`:
 *
 *   - **listDatabases** — enumerate saved snapshots
 *   - **snapshotTo**    — copy current live data into a named snapshot slot
 *   - **restoreFrom**   — overwrite the live data with a named snapshot
 *   - **exportToClipboard** / **importFromClipboard** — portable JSON bundle
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { TulcaseSettings } from '../config';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Folder that holds all named database snapshots. */
const DATABASES_DIR = '_databases';

/**
 * Relative paths (from a baseDir-like root) that make up a complete database.
 * Records are handled separately because they span multiple monthly files.
 */
const CORE_FILES = [
    path.join('todo_db', 'todos.json'),
    path.join('todo_db', 'recurring.json'),
    path.join('tags_db', 'tags.json'),
    path.join('commands_db', 'commands.json'),
    path.join('links_db', 'links.json'),
    path.join('lists_db', 'lists.json'),
    path.join('notes', 'todos.md'),
] as const;

const RECORDS_DIR = 'records_db';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Serialisable bundle used for clipboard export / import. */
export interface DatabaseBundle {
    /** Format marker so we can detect incompatible payloads. */
    _tulcase: 'db-export-v1';
    /** Original snapshot name (informational only). */
    name: string;
    /** ISO timestamp of when the export was created. */
    exportedAt: string;
    /** Core JSON files keyed by their relative path. */
    files: Record<string, string>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Resolve the `_databases` root inside the current baseDir. */
function dbRoot(settings: TulcaseSettings): string {
    return path.join(settings.baseDir, DATABASES_DIR);
}

/** Resolve the full path to a named database snapshot. */
function dbDir(settings: TulcaseSettings, name: string): string {
    return path.join(dbRoot(settings), name);
}

/** Read a file and return its text content, or `undefined` if missing. */
async function safeRead(filePath: string): Promise<string | undefined> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return undefined;
    }
}

/**
 * Recursively collect all files under `dir`, returning their paths relative
 * to `dir`.
 */
async function walkDir(dir: string): Promise<string[]> {
    const result: string[] = [];
    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return result;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const sub = await walkDir(full);
            result.push(...sub.map(s => path.join(entry.name, s)));
        } else {
            result.push(entry.name);
        }
    }
    return result;
}

/**
 * Collect all files that make up a database from a given root directory.
 * Returns a map of `relativePath → fileContent`.
 */
async function collectFiles(root: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};

    // Core single-file stores
    for (const rel of CORE_FILES) {
        const content = await safeRead(path.join(root, rel));
        if (content !== undefined) {
            files[rel] = content;
        }
    }

    // Records directory — walk all year/month.json files
    const recDir = path.join(root, RECORDS_DIR);
    const recFiles = await walkDir(recDir);
    for (const rel of recFiles) {
        const content = await safeRead(path.join(recDir, rel));
        if (content !== undefined) {
            files[path.join(RECORDS_DIR, rel)] = content;
        }
    }

    return files;
}

/**
 * Write a map of `relativePath → fileContent` into a target root directory.
 * Creates subdirectories as needed.
 */
async function writeFiles(
    root: string,
    files: Record<string, string>,
): Promise<void> {
    for (const [rel, content] of Object.entries(files)) {
        const target = path.join(root, rel);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf-8');
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * List the names of all saved database snapshots.
 */
export async function listDatabases(settings: TulcaseSettings): Promise<string[]> {
    const root = dbRoot(settings);
    try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        return entries
            .filter(e => e.isDirectory())
            .map(e => e.name)
            .sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}

/**
 * Snapshot (copy) the current live data into a named database slot.
 * Creates the slot if it doesn't exist; **overwrites** it if it does.
 */
export async function snapshotTo(
    settings: TulcaseSettings,
    name: string,
): Promise<void> {
    const files = await collectFiles(settings.baseDir);
    const target = dbDir(settings, name);
    await writeFiles(target, files);
}

/**
 * Restore a named database snapshot into the live data directory.
 * **Overwrites** the current live data.
 */
export async function restoreFrom(
    settings: TulcaseSettings,
    name: string,
): Promise<void> {
    const source = dbDir(settings, name);
    const files = await collectFiles(source);
    await writeFiles(settings.baseDir, files);
}

/**
 * Serialise a named database snapshot into a portable JSON string suitable
 * for the clipboard.
 */
export async function exportDatabase(
    settings: TulcaseSettings,
    name: string,
): Promise<string> {
    const source = dbDir(settings, name);
    const files = await collectFiles(source);

    const bundle: DatabaseBundle = {
        _tulcase: 'db-export-v1',
        name,
        exportedAt: new Date().toISOString(),
        files,
    };

    return JSON.stringify(bundle);
}

/**
 * Deserialise a clipboard payload and persist it as a new named database.
 *
 * @returns The name under which the database was saved.
 * @throws  If the payload is not a valid Tulcase export.
 */
export async function importDatabase(
    settings: TulcaseSettings,
    payload: string,
    localName: string,
): Promise<string> {
    let bundle: DatabaseBundle;
    try {
        bundle = JSON.parse(payload) as DatabaseBundle;
    } catch {
        throw new Error('Clipboard does not contain valid JSON.');
    }

    if (bundle._tulcase !== 'db-export-v1') {
        throw new Error(
            'Clipboard does not contain a valid Tulcase database export.',
        );
    }

    if (!bundle.files || Object.keys(bundle.files).length === 0) {
        throw new Error('The database export is empty — nothing to import.');
    }

    const target = dbDir(settings, localName);
    await writeFiles(target, bundle.files);
    return localName;
}

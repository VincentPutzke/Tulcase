/**
 * Database management layer for Tulcase.
 *
 * Each database is a named sub-folder under `{rootDir}/data/{name}/` that
 * mirrors the standard Tulcase data layout.  The active database is simply the
 * folder that `settings.baseDir` currently points to — switching databases just
 * changes that pointer (see `switchSettingsTo` in config.ts).
 *
 * This module provides helpers for:
 *
 *   - **listDatabases** — enumerate saved databases
 *   - **createDatabase** — create a new empty database directory
 *   - **exportDatabase** — serialise a database into a portable JSON bundle
 *   - **importDatabase** — deserialise a JSON bundle into a database folder
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { DATABASES_ROOT, ensureDatabase } from '../config';
import type { TulcaseSettings } from '../config';

// ── Types ──────────────────────────────────────────────────────────────────────

/** Serialisable bundle used for clipboard export / import. */
export interface DatabaseBundle {
    /** Format marker so we can detect incompatible payloads. */
    _tulcase: 'db-export-v1';
    /** Database name (informational — the receiver may rename). */
    name: string;
    /** ISO timestamp of when the export was created. */
    exportedAt: string;
    /** All files keyed by their path relative to the database root. */
    files: Record<string, string>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Relative paths (from a database root) for the core single-file stores.
 * Records are walked separately because they span many year/month files.
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

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Read a file and return its text, or `undefined` if missing. */
async function safeRead(filePath: string): Promise<string | undefined> {
    try {
        return await fs.readFile(filePath, 'utf-8');
    } catch {
        return undefined;
    }
}

/** Recursively list all files under `dir`, returning paths relative to `dir`. */
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
 * Collect every file that makes up a database from a given root directory.
 * @returns A map of `relativePath → fileContent`.
 */
async function collectFiles(root: string): Promise<Record<string, string>> {
    const files: Record<string, string> = {};

    for (const rel of CORE_FILES) {
        const content = await safeRead(path.join(root, rel));
        if (content !== undefined) {
            // Normalise to forward slashes so the bundle is cross-platform
            // (Windows path.join produces backslashes which break on Linux).
            files[rel.split(path.sep).join('/')] = content;
        }
    }

    const recDir = path.join(root, RECORDS_DIR);
    for (const rel of await walkDir(recDir)) {
        const content = await safeRead(path.join(recDir, rel));
        if (content !== undefined) {
            const key = path.join(RECORDS_DIR, rel).split(path.sep).join('/');
            files[key] = content;
        }
    }

    return files;
}

/** Write a map of `relativePath → content` into a target directory.
 *
 * Keys may use either `/` (new bundles, normalised on export) or `\` (bundles
 * exported on Windows before this fix).  We split on both so cross-platform
 * imports always reconstruct the correct directory tree.
 */
async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
    for (const [rel, content] of Object.entries(files)) {
        // Split on both `/` and `\` to handle legacy Windows-exported bundles
        // as well as the new forward-slash-normalised keys.
        const segments = rel.split(/[\/\\]/);
        const target = path.join(root, ...segments);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf-8');
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * List the names of all databases under `{rootDir}/data/`.
 */
export async function listDatabases(settings: TulcaseSettings): Promise<string[]> {
    const root = path.join(settings.rootDir, DATABASES_ROOT);
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
 * Create a new empty database.
 */
export async function createDatabase(
    settings: TulcaseSettings,
    name: string,
): Promise<void> {
    const dir = path.join(settings.rootDir, DATABASES_ROOT, name);
    ensureDatabase(dir);
}

/**
 * Serialise a named database into a portable JSON string (for the clipboard).
 */
export async function exportDatabase(
    settings: TulcaseSettings,
    name: string,
): Promise<string> {
    const dir = path.join(settings.rootDir, DATABASES_ROOT, name);
    const files = await collectFiles(dir);

    const bundle: DatabaseBundle = {
        _tulcase: 'db-export-v1',
        name,
        exportedAt: new Date().toISOString(),
        files,
    };

    return JSON.stringify(bundle);
}

/**
 * Deserialise a clipboard payload and persist it as a named database.
 *
 * - If `localName` is given, the database is saved under that name.
 * - If a database with that name already exists its files are **overwritten**
 *   (used by Update to sync the same database across workspaces).
 *
 * @returns The name under which the database was saved.
 * @throws  If the payload is not a valid Tulcase export.
 */
export async function importDatabase(
    settings: TulcaseSettings,
    payload: string,
    localName?: string,
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

    const name = localName || bundle.name;
    const dir = path.join(settings.rootDir, DATABASES_ROOT, name);
    ensureDatabase(dir);
    await writeFiles(dir, bundle.files);
    return name;
}

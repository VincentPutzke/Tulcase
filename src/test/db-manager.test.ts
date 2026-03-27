import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    listDatabases,
    createDatabase,
    exportDatabase,
    importDatabase,
} from '../data/db-manager';
import {
    ensureInitialized,
    ensureDatabase,
    readActiveDb,
    writeActiveDb,
    switchSettingsTo,
    buildSettings,
    DATABASES_ROOT,
    DEFAULT_DB,
} from '../config';
import type { TulcaseSettings } from '../config';

import { vi } from 'vitest';
vi.mock('vscode', () => ({
    workspace: { getConfiguration: () => ({ get: () => '' }) },
}));

/**
 * Build a TulcaseSettings pointing at a temp rootDir + database name.
 */
function fakeSettings(rootDir: string, dbName: string = DEFAULT_DB): TulcaseSettings {
    const baseDir = path.join(rootDir, DATABASES_ROOT, dbName);
    return {
        rootDir,
        activeDb: dbName,
        baseDir,
        todosFile:     path.join(baseDir, 'todo_db', 'todos.json'),
        tagsFile:      path.join(baseDir, 'tags_db', 'tags.json'),
        recurringFile: path.join(baseDir, 'todo_db', 'recurring.json'),
        commandsFile:  path.join(baseDir, 'commands_db', 'commands.json'),
        linksFile:     path.join(baseDir, 'links_db', 'links.json'),
        listsFile:     path.join(baseDir, 'lists_db', 'lists.json'),
        recordsDir:    path.join(baseDir, 'records_db'),
        todoPage:      path.join(baseDir, 'notes', 'todos.md'),
    };
}

/**
 * Seed a minimal database with sample data inside a named db directory.
 */
function seedDatabase(rootDir: string, dbName: string): void {
    const base = path.join(rootDir, DATABASES_ROOT, dbName);
    ensureDatabase(base);
    fs.writeFileSync(
        path.join(base, 'todo_db', 'todos.json'),
        JSON.stringify({ items: [{ id: 't1', note: 'Test todo' }] }),
    );
    fs.writeFileSync(
        path.join(base, 'tags_db', 'tags.json'),
        JSON.stringify({ tags: { dev: { color: '#ff0' } } }),
    );
    // Add a record file to test walkDir
    const recDir = path.join(base, 'records_db', '2026');
    fs.mkdirSync(recDir, { recursive: true });
    fs.writeFileSync(
        path.join(recDir, '03.json'),
        JSON.stringify({ year: 2026, month: 3, days: { '15': [{ time_spent_min: 60 }] } }),
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('db-manager', () => {
    let tmpDir: string;
    let settings: TulcaseSettings;

    beforeEach(() => {
        tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'tulcase-db-test-'));
        settings = fakeSettings(tmpDir);
        seedDatabase(tmpDir, DEFAULT_DB);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── listDatabases ──────────────────────────────────────────────────────

    it('lists created databases alphabetically', async () => {
        ensureDatabase(path.join(tmpDir, DATABASES_ROOT, 'beta'));
        ensureDatabase(path.join(tmpDir, DATABASES_ROOT, 'alpha'));
        const names = await listDatabases(settings);
        expect(names).toEqual(['alpha', 'beta', 'default']);
    });

    it('returns only default when no others exist', async () => {
        const names = await listDatabases(settings);
        expect(names).toEqual(['default']);
    });

    // ── createDatabase ─────────────────────────────────────────────────────

    it('creates a new empty database directory', async () => {
        await createDatabase(settings, 'project-x');
        const dir = path.join(tmpDir, DATABASES_ROOT, 'project-x', 'todo_db');
        expect(fs.existsSync(dir)).toBe(true);
    });

    // ── exportDatabase ─────────────────────────────────────────────────────

    it('export payload has correct format and data', async () => {
        const payload = await exportDatabase(settings, DEFAULT_DB);
        const parsed = JSON.parse(payload);
        expect(parsed._tulcase).toBe('db-export-v1');
        expect(parsed.name).toBe(DEFAULT_DB);
        expect(parsed.exportedAt).toBeTruthy();
        expect(parsed.files).toHaveProperty('todo_db/todos.json');
    });

    it('export includes records subdirectory files', async () => {
        const payload = await exportDatabase(settings, DEFAULT_DB);
        const parsed = JSON.parse(payload);
        const recKey = 'records_db/2026/03.json';
        expect(parsed.files).toHaveProperty(recKey);
        const rec = JSON.parse(parsed.files[recKey]);
        expect(rec.year).toBe(2026);
    });

    // ── importDatabase ─────────────────────────────────────────────────────

    it('export → import round-trip preserves data', async () => {
        const payload = await exportDatabase(settings, DEFAULT_DB);
        const name = await importDatabase(settings, payload, 'imported');
        expect(name).toBe('imported');

        const todosPath = path.join(
            tmpDir, DATABASES_ROOT, 'imported', 'todo_db', 'todos.json',
        );
        const data = JSON.parse(fs.readFileSync(todosPath, 'utf-8'));
        expect(data.items[0].note).toBe('Test todo');
    });

    it('import uses bundle name when no localName given', async () => {
        const payload = await exportDatabase(settings, DEFAULT_DB);
        const name = await importDatabase(settings, payload);
        expect(name).toBe(DEFAULT_DB);
    });

    it('import rejects invalid JSON', async () => {
        await expect(
            importDatabase(settings, 'not json', 'bad'),
        ).rejects.toThrow('valid JSON');
    });

    it('import rejects payload without format marker', async () => {
        await expect(
            importDatabase(settings, JSON.stringify({ x: 1 }), 'bad'),
        ).rejects.toThrow('valid Tulcase database export');
    });

    it('import rejects empty export', async () => {
        const empty = JSON.stringify({
            _tulcase: 'db-export-v1',
            name: 'empty',
            exportedAt: new Date().toISOString(),
            files: {},
        });
        await expect(
            importDatabase(settings, empty, 'bad'),
        ).rejects.toThrow('empty');
    });
});

// ── Config / init tests ────────────────────────────────────────────────────────

describe('config — database init', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tulcase-init-test-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('ensureInitialized creates default database on first run', () => {
        ensureInitialized(tmpDir);
        const todosFile = path.join(tmpDir, DATABASES_ROOT, DEFAULT_DB, 'todo_db', 'todos.json');
        expect(fs.existsSync(todosFile)).toBe(true);
        expect(readActiveDb(tmpDir)).toBe(DEFAULT_DB);
    });

    it('ensureInitialized migrates legacy flat data into default', () => {
        // Create legacy flat structure
        const legacyTodoDir = path.join(tmpDir, 'todo_db');
        fs.mkdirSync(legacyTodoDir, { recursive: true });
        fs.writeFileSync(
            path.join(legacyTodoDir, 'todos.json'),
            JSON.stringify({ items: [{ note: 'legacy' }] }),
        );

        ensureInitialized(tmpDir);

        // Legacy data should be copied into data/default/
        const migratedFile = path.join(tmpDir, DATABASES_ROOT, DEFAULT_DB, 'todo_db', 'todos.json');
        const data = JSON.parse(fs.readFileSync(migratedFile, 'utf-8'));
        expect(data.items[0].note).toBe('legacy');
    });

    it('ensureInitialized is idempotent', () => {
        ensureInitialized(tmpDir);
        // Write custom data
        const todosFile = path.join(tmpDir, DATABASES_ROOT, DEFAULT_DB, 'todo_db', 'todos.json');
        fs.writeFileSync(todosFile, JSON.stringify({ items: [{ note: 'custom' }] }));

        ensureInitialized(tmpDir); // second call must not overwrite

        const data = JSON.parse(fs.readFileSync(todosFile, 'utf-8'));
        expect(data.items[0].note).toBe('custom');
    });

    it('buildSettings returns paths under data/{dbName}/', () => {
        ensureInitialized(tmpDir);
        const settings = buildSettings(tmpDir, 'mydb');
        expect(settings.rootDir).toBe(tmpDir);
        expect(settings.activeDb).toBe('mydb');
        expect(settings.baseDir).toBe(path.join(tmpDir, DATABASES_ROOT, 'mydb'));
        expect(settings.todosFile).toContain(path.join('mydb', 'todo_db', 'todos.json'));
    });

    it('switchSettingsTo mutates settings in place', () => {
        ensureInitialized(tmpDir);
        const settings = buildSettings(tmpDir);
        expect(settings.activeDb).toBe(DEFAULT_DB);

        ensureDatabase(path.join(tmpDir, DATABASES_ROOT, 'other'));
        switchSettingsTo(settings, 'other');

        expect(settings.activeDb).toBe('other');
        expect(settings.baseDir).toContain(path.join(DATABASES_ROOT, 'other'));
        expect(readActiveDb(tmpDir)).toBe('other');
    });

    it('writeActiveDb + readActiveDb round-trip', () => {
        writeActiveDb(tmpDir, 'my-project');
        expect(readActiveDb(tmpDir)).toBe('my-project');
    });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    listDatabases,
    snapshotTo,
    restoreFrom,
    exportDatabase,
    importDatabase,
} from '../data/db-manager';
import type { TulcaseSettings } from '../config';

/**
 * Build a minimal TulcaseSettings pointing at a temp directory.
 */
function fakeSettings(baseDir: string): TulcaseSettings {
    return {
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
 * Seed a minimal live database in the given baseDir.
 */
function seedLiveData(baseDir: string): void {
    const dirs = [
        path.join(baseDir, 'todo_db'),
        path.join(baseDir, 'tags_db'),
        path.join(baseDir, 'commands_db'),
        path.join(baseDir, 'links_db'),
        path.join(baseDir, 'lists_db'),
        path.join(baseDir, 'records_db', '2026'),
        path.join(baseDir, 'notes'),
    ];
    for (const d of dirs) {
        fs.mkdirSync(d, { recursive: true });
    }

    fs.writeFileSync(
        path.join(baseDir, 'todo_db', 'todos.json'),
        JSON.stringify({ items: [{ id: 't1', note: 'Test todo' }] }),
    );
    fs.writeFileSync(
        path.join(baseDir, 'tags_db', 'tags.json'),
        JSON.stringify({ tags: { dev: { color: '#ff0' } } }),
    );
    fs.writeFileSync(
        path.join(baseDir, 'commands_db', 'commands.json'),
        JSON.stringify({ items: [] }),
    );
    fs.writeFileSync(
        path.join(baseDir, 'links_db', 'links.json'),
        JSON.stringify({ root: [] }),
    );
    fs.writeFileSync(
        path.join(baseDir, 'lists_db', 'lists.json'),
        JSON.stringify({ notes: [], folders: [] }),
    );
    fs.writeFileSync(
        path.join(baseDir, 'todo_db', 'recurring.json'),
        JSON.stringify([]),
    );
    fs.writeFileSync(
        path.join(baseDir, 'notes', 'todos.md'),
        '# My Todos\n',
    );
    // A sample monthly record
    fs.writeFileSync(
        path.join(baseDir, 'records_db', '2026', '03.json'),
        JSON.stringify({ year: 2026, month: 3, days: { '15': [{ time_spent_min: 60, notes: 'Coding' }] } }),
    );
}

describe('db-manager', () => {
    let tmpDir: string;
    let settings: TulcaseSettings;

    beforeEach(() => {
        tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'tulcase-db-test-'));
        settings = fakeSettings(tmpDir);
        seedLiveData(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── listDatabases ──────────────────────────────────────────────────────

    it('returns empty list when no databases exist', async () => {
        const result = await listDatabases(settings);
        expect(result).toEqual([]);
    });

    it('lists created databases alphabetically', async () => {
        await snapshotTo(settings, 'beta');
        await snapshotTo(settings, 'alpha');
        const names = await listDatabases(settings);
        expect(names).toEqual(['alpha', 'beta']);
    });

    // ── snapshotTo ─────────────────────────────────────────────────────────

    it('creates a snapshot of live data', async () => {
        await snapshotTo(settings, 'my-backup');

        const snapshotTodos = path.join(tmpDir, '_databases', 'my-backup', 'todo_db', 'todos.json');
        expect(fs.existsSync(snapshotTodos)).toBe(true);

        const data = JSON.parse(fs.readFileSync(snapshotTodos, 'utf-8'));
        expect(data.items[0].note).toBe('Test todo');
    });

    it('includes records in the snapshot', async () => {
        await snapshotTo(settings, 'with-records');

        const recFile = path.join(tmpDir, '_databases', 'with-records', 'records_db', '2026', '03.json');
        expect(fs.existsSync(recFile)).toBe(true);

        const data = JSON.parse(fs.readFileSync(recFile, 'utf-8'));
        expect(data.year).toBe(2026);
        expect(data.days['15'][0].time_spent_min).toBe(60);
    });

    // ── restoreFrom ────────────────────────────────────────────────────────

    it('restores a snapshot over live data', async () => {
        // Snapshot current state
        await snapshotTo(settings, 'original');

        // Modify the live data
        fs.writeFileSync(
            settings.todosFile,
            JSON.stringify({ items: [{ id: 't2', note: 'Modified' }] }),
        );

        // Restore original
        await restoreFrom(settings, 'original');

        const restored = JSON.parse(fs.readFileSync(settings.todosFile, 'utf-8'));
        expect(restored.items[0].note).toBe('Test todo');
    });

    // ── exportDatabase / importDatabase ────────────────────────────────────

    it('export → import round-trip preserves all data', async () => {
        await snapshotTo(settings, 'export-me');
        const payload = await exportDatabase(settings, 'export-me');

        // Import into a new name
        const savedName = await importDatabase(settings, payload, 'imported');
        expect(savedName).toBe('imported');

        // Verify imported data matches
        const importedTodos = path.join(
            tmpDir, '_databases', 'imported', 'todo_db', 'todos.json',
        );
        const data = JSON.parse(fs.readFileSync(importedTodos, 'utf-8'));
        expect(data.items[0].note).toBe('Test todo');
    });

    it('export payload is valid JSON with format marker', async () => {
        await snapshotTo(settings, 'check-format');
        const payload = await exportDatabase(settings, 'check-format');

        const parsed = JSON.parse(payload);
        expect(parsed._tulcase).toBe('db-export-v1');
        expect(parsed.name).toBe('check-format');
        expect(parsed.exportedAt).toBeTruthy();
        expect(typeof parsed.files).toBe('object');
    });

    it('import rejects invalid JSON', async () => {
        await expect(
            importDatabase(settings, 'not json', 'bad'),
        ).rejects.toThrow('valid JSON');
    });

    it('import rejects payload without format marker', async () => {
        const fake = JSON.stringify({ something: 'else' });
        await expect(
            importDatabase(settings, fake, 'bad'),
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

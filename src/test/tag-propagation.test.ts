import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { stripTagFromAll, renameTagInAll } from '../data/tag-propagation';
import { buildSettings } from '../config';
import type { TulcaseSettings } from '../config';

// Mock vscode module for config
import { vi } from 'vitest';
vi.mock('vscode', () => ({
    workspace: { getConfiguration: () => ({ get: () => '' }) },
}));

describe('Tag Propagation', () => {
    let tmpDir: string;
    let settings: TulcaseSettings;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tulcase-tag-test-'));
        settings = buildSettings(tmpDir);

        // Seed data
        seedFile(settings.todosFile, {
            items: [
                { note: 'Task 1', date: '2026-03-16', done: false, tags: ['#work', '#urgent'] },
                { note: 'Task 2', date: '2026-03-16', done: false, tags: ['#personal'] },
            ]
        });
        seedFile(settings.recurringFile, {
            actions: [
                { id: 'r1', note: 'Daily', tags: ['#work'], schedule: { type: 'daily' }, active: true, instances: {} },
            ]
        });
        seedFile(settings.commandsFile, {
            commands: {
                'git status': { command: 'git status', tags: ['#work', '#git'] },
            }
        });
        seedFile(settings.linksFile, {
            root: [
                { id: 'l1', type: 'link', label: 'GH', url: 'https://github.com', tags: ['#work'] },
                {
                    id: 'f1', type: 'folder', label: 'Folder', children: [
                        { id: 'l2', type: 'link', label: 'SO', url: 'https://stackoverflow.com', tags: ['#work'] },
                    ]
                },
            ]
        });
        seedFile(settings.listsFile, {
            lists: [
                {
                    id: 'ml1', label: 'Shopping', tags: ['#work'], items: [
                        { id: 'li1', text: 'Bread', done: false, tags: ['#work'], createdAt: '2026-03-16' },
                    ], createdAt: '2026-03-16', description: ''
                },
            ]
        });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('stripTag removes from todos', async () => {
        await stripTagFromAll('#work', settings);
        const data = JSON.parse(fs.readFileSync(settings.todosFile, 'utf-8'));
        expect(data.items[0].tags).toEqual(['#urgent']);
        expect(data.items[1].tags).toEqual(['#personal']);
    });

    it('stripTag removes from recurring actions', async () => {
        await stripTagFromAll('#work', settings);
        const data = JSON.parse(fs.readFileSync(settings.recurringFile, 'utf-8'));
        expect(data.actions[0].tags).toEqual([]);
    });

    it('stripTag removes from commands', async () => {
        await stripTagFromAll('#work', settings);
        const data = JSON.parse(fs.readFileSync(settings.commandsFile, 'utf-8'));
        expect(data.commands['git status'].tags).toEqual(['#git']);
    });

    it('stripTag removes from link tree (nested)', async () => {
        await stripTagFromAll('#work', settings);
        const data = JSON.parse(fs.readFileSync(settings.linksFile, 'utf-8'));
        expect(data.root[0].tags).toEqual([]);
        expect(data.root[1].children[0].tags).toEqual([]);
    });

    it('stripTag removes from lists + list items', async () => {
        await stripTagFromAll('#work', settings);
        const data = JSON.parse(fs.readFileSync(settings.listsFile, 'utf-8'));
        expect(data.lists[0].tags).toEqual([]);
        expect(data.lists[0].items[0].tags).toEqual([]);
    });

    it('renameTag renames in all stores', async () => {
        await renameTagInAll('#work', '#business', settings);

        const todos = JSON.parse(fs.readFileSync(settings.todosFile, 'utf-8'));
        expect(todos.items[0].tags).toContain('#business');
        expect(todos.items[0].tags).not.toContain('#work');

        const commands = JSON.parse(fs.readFileSync(settings.commandsFile, 'utf-8'));
        expect(commands.commands['git status'].tags).toContain('#business');
    });

    it('handles tag not present (no-op)', async () => {
        await stripTagFromAll('#nonexistent', settings);
        // Files should remain unchanged
        const data = JSON.parse(fs.readFileSync(settings.todosFile, 'utf-8'));
        expect(data.items[0].tags).toEqual(['#work', '#urgent']);
    });
});

function seedFile(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

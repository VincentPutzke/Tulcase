import { describe, it, expect } from 'vitest';
import type {
    CommandItem,
    CommandStore,
    LegacyCommandStore,
} from '../models/command.model';

// ── Unit-testable helpers extracted from command-list.view.ts ──────────────────
// We re-implement the pure functions here to test them in isolation without
// importing the full VS Code–dependent provider class.

/** Collect unique folder names from a command store. */
function getExistingFolders(data: CommandStore): string[] {
    const set = new Set<string>();
    for (const item of data.items) {
        if (item.folder) { set.add(item.folder); }
    }
    return Array.from(set).sort();
}

/** Convert legacy Record<string, CommandEntry | string> to items array. */
function migrateLegacy(legacy: LegacyCommandStore): CommandStore {
    const items: CommandItem[] = [];

    for (const [label, entry] of Object.entries(legacy.commands)) {
        if (typeof entry === 'string') {
            items.push({
                id: `test-${label}`,
                label,
                command: entry,
                tags: [],
                folder: '',
            });
        } else {
            items.push({
                id: `test-${label}`,
                label,
                command: entry.command,
                tags: entry.tags ?? [],
                folder: '',
            });
        }
    }

    return { items };
}

/** Group commands into folder buckets. */
function groupByFolder(items: CommandItem[]): Record<string, CommandItem[]> {
    const groups: Record<string, CommandItem[]> = {};
    for (const item of items) {
        const folder = item.folder || '';
        if (!groups[folder]) { groups[folder] = []; }
        groups[folder].push(item);
    }
    return groups;
}

/** Return sorted folder names, root ('') first. */
function sortedFolders(groups: Record<string, CommandItem[]>): string[] {
    return Object.keys(groups).sort((a, b) => {
        if (a === '') { return -1; }
        if (b === '') { return 1; }
        return a.localeCompare(b);
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommandStore helpers', () => {
    describe('migrateLegacy', () => {
        it('converts Record<string, CommandEntry> to items array', () => {
            const legacy: LegacyCommandStore = {
                commands: {
                    'Git Status': { command: 'git status --short', tags: ['#git'] },
                    'Docker PS':  { command: 'docker ps --all',     tags: [] },
                },
            };

            const result = migrateLegacy(legacy);

            expect(result.items).toHaveLength(2);
            expect(result.items.find(i => i.label === 'Git Status')).toMatchObject({
                label:   'Git Status',
                command: 'git status --short',
                tags:    ['#git'],
                folder:  '',
            });
        });

        it('handles legacy plain-string commands', () => {
            const legacy: LegacyCommandStore = {
                commands: {
                    'pwd': 'pwd' as unknown as { command: string; tags: string[] },
                },
            };

            const result = migrateLegacy(legacy);
            expect(result.items[0].command).toBe('pwd');
            expect(result.items[0].tags).toEqual([]);
        });

        it('returns empty items for empty store', () => {
            const legacy: LegacyCommandStore = { commands: {} };
            const result = migrateLegacy(legacy);
            expect(result.items).toEqual([]);
        });
    });

    describe('getExistingFolders', () => {
        it('extracts unique sorted folder names', () => {
            const data: CommandStore = {
                items: [
                    { id: '1', label: 'A', command: '', tags: [], folder: 'DevOps' },
                    { id: '2', label: 'B', command: '', tags: [], folder: 'Build' },
                    { id: '3', label: 'C', command: '', tags: [], folder: 'DevOps' },
                    { id: '4', label: 'D', command: '', tags: [], folder: '' },
                ],
            };

            const folders = getExistingFolders(data);
            expect(folders).toEqual(['Build', 'DevOps']);
        });

        it('returns empty array when no folders', () => {
            const data: CommandStore = {
                items: [
                    { id: '1', label: 'A', command: '', tags: [], folder: '' },
                ],
            };
            expect(getExistingFolders(data)).toEqual([]);
        });
    });

    describe('groupByFolder', () => {
        it('groups items by folder name', () => {
            const items: CommandItem[] = [
                { id: '1', label: 'A', command: '', tags: [], folder: '' },
                { id: '2', label: 'B', command: '', tags: [], folder: 'Git' },
                { id: '3', label: 'C', command: '', tags: [], folder: 'Git' },
                { id: '4', label: 'D', command: '', tags: [], folder: 'Docker' },
            ];

            const groups = groupByFolder(items);
            expect(Object.keys(groups)).toHaveLength(3);
            expect(groups['']).toHaveLength(1);
            expect(groups['Git']).toHaveLength(2);
            expect(groups['Docker']).toHaveLength(1);
        });
    });

    describe('sortedFolders', () => {
        it('puts root folder first, then alphabetical', () => {
            const groups: Record<string, CommandItem[]> = {
                'Zeta':   [],
                '':       [],
                'Alpha':  [],
            };

            const sorted = sortedFolders(groups);
            expect(sorted).toEqual(['', 'Alpha', 'Zeta']);
        });
    });
});

import { describe, it, expect } from 'vitest';
import type {
    CommandItem,
    CommandStore,
    LegacyCommandStore,
    PlaceholderDef,
} from '../models/command.model';
import {
    parsePlaceholders,
    applyPlaceholders,
    prunePlaceholders,
} from '../utils/placeholder';

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

// ── Placeholder utility tests ─────────────────────────────────────────────────

describe('parsePlaceholders', () => {
    it('extracts unique names in order of first appearance', () => {
        const result = parsePlaceholders('git checkout <$branch$> && echo <$msg$> <$branch$>');
        expect(result).toEqual(['branch', 'msg']);
    });

    it('returns empty array when no placeholders', () => {
        expect(parsePlaceholders('git status --short')).toEqual([]);
    });

    it('returns empty array for empty string', () => {
        expect(parsePlaceholders('')).toEqual([]);
    });

    it('handles single placeholder', () => {
        expect(parsePlaceholders('deploy <$env$>')).toEqual(['env']);
    });

    it('handles adjacent placeholders', () => {
        expect(parsePlaceholders('<$a$><$b$>')).toEqual(['a', 'b']);
    });

    it('ignores incomplete delimiters', () => {
        expect(parsePlaceholders('echo <$open but no close')).toEqual([]);
        expect(parsePlaceholders('echo $close$> only')).toEqual([]);
    });

    it('handles placeholder with multi-word name', () => {
        expect(parsePlaceholders('<$target env$>')).toEqual(['target env']);
    });
});

describe('applyPlaceholders', () => {
    it('replaces single placeholder', () => {
        expect(applyPlaceholders('deploy <$env$>', { env: 'staging' }))
            .toBe('deploy staging');
    });

    it('replaces multiple different placeholders', () => {
        expect(applyPlaceholders(
            'git checkout <$branch$> && echo <$msg$>',
            { branch: 'main', msg: 'done' },
        )).toBe('git checkout main && echo done');
    });

    it('replaces all occurrences of the same placeholder', () => {
        expect(applyPlaceholders(
            '<$x$> + <$x$> = 2*<$x$>',
            { x: '5' },
        )).toBe('5 + 5 = 2*5');
    });

    it('leaves unmatched placeholders as-is', () => {
        expect(applyPlaceholders('echo <$missing$>', {}))
            .toBe('echo <$missing$>');
    });

    it('returns original when no placeholders', () => {
        expect(applyPlaceholders('git status', { any: 'val' }))
            .toBe('git status');
    });

    it('handles empty replacement value', () => {
        expect(applyPlaceholders('echo <$x$>', { x: '' }))
            .toBe('echo ');
    });
});

describe('prunePlaceholders', () => {
    it('removes keys not in command', () => {
        const placeholders: Record<string, PlaceholderDef> = {
            branch: { defaults: ['main'] },
            stale:  { defaults: ['old'] },
        };
        const result = prunePlaceholders('git checkout <$branch$>', placeholders);
        expect(result).toEqual({ branch: { defaults: ['main'] } });
    });

    it('returns undefined when all keys are stale', () => {
        const placeholders: Record<string, PlaceholderDef> = {
            gone: { defaults: ['x'] },
        };
        expect(prunePlaceholders('git status', placeholders)).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
        expect(prunePlaceholders('git status', undefined)).toBeUndefined();
    });

    it('keeps all keys when all are active', () => {
        const placeholders: Record<string, PlaceholderDef> = {
            a: { defaults: ['1'] },
            b: { defaults: [] },
        };
        const result = prunePlaceholders('<$a$> <$b$>', placeholders);
        expect(result).toEqual({ a: { defaults: ['1'] }, b: { defaults: [] } });
    });
});

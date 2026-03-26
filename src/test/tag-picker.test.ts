import { describe, it, expect, vi } from 'vitest';
import type { TagDef } from '../models/tag.model';

// Mock vscode before importing the module under test
vi.mock('vscode', () => ({
    QuickPickItemKind: { Separator: -1 },
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    window: { showQuickPick: vi.fn(), showInformationMessage: vi.fn() },
    workspace: { getConfiguration: () => ({ get: () => '' }) },
}));

import { groupByCategory } from '../data/tag-picker';

describe('Tag Picker — groupByCategory', () => {
    it('returns empty array for empty map', () => {
        expect(groupByCategory({})).toEqual([]);
    });

    it('groups tags by category alphabetically', () => {
        const tags: Record<string, TagDef> = {
            '#urgent': { color: '#ff0000', category: 'priority' },
            '#bug':    { color: '#ff5c5c', category: 'type' },
            '#low':    { color: '#00ff00', category: 'priority' },
            '#docs':   { color: '#0000ff', category: 'type' },
        };

        const result = groupByCategory(tags);

        expect(result).toHaveLength(2);
        expect(result[0][0]).toBe('priority');
        expect(result[1][0]).toBe('type');
    });

    it('sorts tags alphabetically within each category', () => {
        const tags: Record<string, TagDef> = {
            '#zeta':  { color: '#111', category: 'greek' },
            '#alpha': { color: '#222', category: 'greek' },
            '#beta':  { color: '#333', category: 'greek' },
        };

        const result = groupByCategory(tags);
        const names = result[0][1].map(([n]) => n);
        expect(names).toEqual(['#alpha', '#beta', '#zeta']);
    });

    it('defaults to "general" for tags without category', () => {
        const tags: Record<string, TagDef> = {
            '#misc': { color: '#aaa', category: '' },
            '#work': { color: '#bbb', category: 'job' },
        };

        const result = groupByCategory(tags);
        expect(result[0][0]).toBe('general');
        expect(result[1][0]).toBe('job');
    });

    it('preserves tag definitions in output', () => {
        const def: TagDef = { color: '#7c6aff', category: 'style' };
        const tags: Record<string, TagDef> = { '#purple': def };

        const result = groupByCategory(tags);
        expect(result[0][1][0]).toEqual(['#purple', def]);
    });
});

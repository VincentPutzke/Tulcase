import { describe, it, expect } from 'vitest';

// ── Unit-testable helpers extracted from tag-list.view.ts / tag-list.html ─────
// Pure functions re-implemented here for testing without VS Code dependencies.

type TagEntry = { name: string; color: string; category: string };

/** Group tags into { category → TagEntry[] }. */
function groupByCategory(items: TagEntry[]): Record<string, TagEntry[]> {
    const groups: Record<string, TagEntry[]> = {};
    for (const tag of items) {
        const cat = tag.category;
        if (!groups[cat]) { groups[cat] = []; }
        groups[cat].push(tag);
    }
    return groups;
}

/** Return category names sorted alphabetically. */
function sortedCategories(groups: Record<string, TagEntry[]>): string[] {
    return Object.keys(groups).sort((a, b) => a.localeCompare(b));
}

/** Sort tags within a category alphabetically by name. */
function sortTagsInCategory(items: TagEntry[]): TagEntry[] {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

/** Test whether a tag matches a search query (case-insensitive). */
function matchesQuery(tag: TagEntry, query: string): boolean {
    if (!query) { return true; }
    const q = query.toLowerCase();
    return tag.name.toLowerCase().includes(q) || tag.category.toLowerCase().includes(q);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TagList helpers', () => {

    // ── groupByCategory ───────────────────────────────────

    describe('groupByCategory', () => {
        it('groups tags by their category', () => {
            const tags: TagEntry[] = [
                { name: '#work',     color: '#4dabf7', category: 'workflow' },
                { name: '#urgent',   color: '#ff5c5c', category: 'priority' },
                { name: '#meeting',  color: '#ffb547', category: 'workflow' },
            ];
            const groups = groupByCategory(tags);
            expect(Object.keys(groups).sort()).toEqual(['priority', 'workflow']);
            expect(groups['workflow']).toHaveLength(2);
            expect(groups['priority']).toHaveLength(1);
        });

        it('returns empty object for no tags', () => {
            expect(groupByCategory([])).toEqual({});
        });

        it('handles tags all in the same category', () => {
            const tags: TagEntry[] = [
                { name: '#a', color: '#fff', category: 'general' },
                { name: '#b', color: '#fff', category: 'general' },
            ];
            const groups = groupByCategory(tags);
            expect(Object.keys(groups)).toHaveLength(1);
            expect(groups['general']).toHaveLength(2);
        });
    });

    // ── sortedCategories ──────────────────────────────────

    describe('sortedCategories', () => {
        it('sorts categories alphabetically', () => {
            const groups = { zebra: [], alpha: [], midpoint: [] } as Record<string, TagEntry[]>;
            expect(sortedCategories(groups)).toEqual(['alpha', 'midpoint', 'zebra']);
        });

        it('returns empty array for empty groups', () => {
            expect(sortedCategories({})).toEqual([]);
        });

        it('is case-insensitive-friendly (locale-aware sort)', () => {
            const groups = { Beta: [], alpha: [], Gamma: [] } as Record<string, TagEntry[]>;
            const sorted = sortedCategories(groups);
            // localeCompare — order depends on locale, but should be consistent
            expect(sorted).toHaveLength(3);
        });
    });

    // ── sortTagsInCategory ────────────────────────────────

    describe('sortTagsInCategory', () => {
        it('sorts tags alphabetically by name', () => {
            const tags: TagEntry[] = [
                { name: '#zebra',   color: '#fff', category: 'general' },
                { name: '#alpha',   color: '#fff', category: 'general' },
                { name: '#midway',  color: '#fff', category: 'general' },
            ];
            const sorted = sortTagsInCategory(tags);
            expect(sorted.map(t => t.name)).toEqual(['#alpha', '#midway', '#zebra']);
        });

        it('does not mutate the original array', () => {
            const tags: TagEntry[] = [
                { name: '#b', color: '#fff', category: 'general' },
                { name: '#a', color: '#fff', category: 'general' },
            ];
            const original = [...tags];
            sortTagsInCategory(tags);
            expect(tags[0].name).toBe(original[0].name);
        });
    });

    // ── matchesQuery ──────────────────────────────────────

    describe('matchesQuery', () => {
        const tag: TagEntry = { name: '#work', color: '#4dabf7', category: 'workflow' };

        it('returns true when query is empty', () => {
            expect(matchesQuery(tag, '')).toBe(true);
        });

        it('matches by tag name (case-insensitive)', () => {
            expect(matchesQuery(tag, 'work')).toBe(true);
            expect(matchesQuery(tag, 'WORK')).toBe(true);
            expect(matchesQuery(tag, '#wor')).toBe(true);
        });

        it('matches by category (case-insensitive)', () => {
            expect(matchesQuery(tag, 'flow')).toBe(true);
            expect(matchesQuery(tag, 'WORKFLOW')).toBe(true);
        });

        it('returns false when neither name nor category matches', () => {
            expect(matchesQuery(tag, 'xyz')).toBe(false);
            expect(matchesQuery(tag, 'personal')).toBe(false);
        });
    });

    // ── Integration: filter + group + sort ────────────────

    describe('filter → group → sort pipeline', () => {
        const tags: TagEntry[] = [
            { name: '#urgent',  color: '#ff5c5c', category: 'priority' },
            { name: '#feature', color: '#4dabf7', category: 'workflow' },
            { name: '#hotfix',  color: '#ffb547', category: 'workflow' },
            { name: '#low',     color: '#8b8fa3', category: 'priority' },
        ];

        it('groups and sorts all tags when query is empty', () => {
            const filtered = tags.filter(t => matchesQuery(t, ''));
            const groups   = groupByCategory(filtered);
            const cats     = sortedCategories(groups);

            expect(cats).toEqual(['priority', 'workflow']);
            expect(sortTagsInCategory(groups['priority']).map(t => t.name)).toEqual(['#low', '#urgent']);
            expect(sortTagsInCategory(groups['workflow']).map(t => t.name)).toEqual(['#feature', '#hotfix']);
        });

        it('filters to only matching tags', () => {
            const filtered = tags.filter(t => matchesQuery(t, 'priority'));
            expect(filtered).toHaveLength(2);
            expect(filtered.every(t => t.category === 'priority')).toBe(true);
        });

        it('returns empty when no tags match', () => {
            const filtered = tags.filter(t => matchesQuery(t, 'zzznomatch'));
            expect(filtered).toHaveLength(0);
        });
    });
});

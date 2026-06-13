import { describe, it, expect } from 'vitest';
import { mergeStoreFile, isMergeableStore } from '../sync/data-merge';

const J = (v: unknown) => JSON.stringify(v, null, 2);
const parse = (text: string) => JSON.parse(text);

describe('mergeStoreFile — notes (the classic two-machine case)', () => {
    const basePath = 'data/default/lists_db/lists.json';
    const note = (id: string, label: string, updatedAt = '2026-06-01T10:00:00Z', content = '') => ({
        id, label, content, tags: [], folder: '',
        createdAt: '2026-06-01T09:00:00Z', updatedAt,
    });

    it('merges a note added on each side (no conflict left)', () => {
        const base = J({ notes: [note('a', 'A')], folders: [] });
        const ours = J({ notes: [note('a', 'A'), note('b', 'B-local')], folders: [] });
        const theirs = J({ notes: [note('a', 'A'), note('c', 'C-remote')], folders: [] });

        const out = mergeStoreFile(basePath, base, ours, theirs)!;
        expect(out).toBeDefined();
        const merged = parse(out.text);
        expect(merged.notes.map((n: { id: string }) => n.id)).toEqual(['a', 'b', 'c']);
        expect(out.softConflicts).toBe(0);
    });

    it('single-side edits flow through', () => {
        const base = J({ notes: [note('a', 'A')], folders: [] });
        const ours = J({ notes: [note('a', 'A')], folders: [] });
        const theirs = J({ notes: [note('a', 'A-renamed', '2026-06-02T10:00:00Z')], folders: [] });

        const merged = parse(mergeStoreFile(basePath, base, ours, theirs)!.text);
        expect(merged.notes[0].label).toBe('A-renamed');
    });

    it('double edit: newer updatedAt wins and counts as soft conflict', () => {
        const base = J({ notes: [note('a', 'A')], folders: [] });
        const ours = J({ notes: [note('a', 'A-local', '2026-06-02T08:00:00Z')], folders: [] });
        const theirs = J({ notes: [note('a', 'A-remote', '2026-06-02T09:30:00Z')], folders: [] });

        const out = mergeStoreFile(basePath, base, ours, theirs)!;
        const merged = parse(out.text);
        expect(merged.notes[0].label).toBe('A-remote');
        expect(out.softConflicts).toBe(1);
    });

    it('edit beats delete', () => {
        const base = J({ notes: [note('a', 'A'), note('b', 'B')], folders: [] });
        // local deleted b; remote edited b
        const ours = J({ notes: [note('a', 'A')], folders: [] });
        const theirs = J({ notes: [note('a', 'A'), note('b', 'B-edited', '2026-06-03T10:00:00Z')], folders: [] });

        const merged = parse(mergeStoreFile(basePath, base, ours, theirs)!.text);
        expect(merged.notes.map((n: { id: string }) => n.id)).toEqual(['a', 'b']);
        expect(merged.notes[1].label).toBe('B-edited');
    });

    it('delete on one side with no remote edit is honored', () => {
        const base = J({ notes: [note('a', 'A'), note('b', 'B')], folders: [] });
        const ours = J({ notes: [note('a', 'A')], folders: [] });
        const theirs = J({ notes: [note('a', 'A'), note('b', 'B')], folders: [] });

        const merged = parse(mergeStoreFile(basePath, base, ours, theirs)!.text);
        expect(merged.notes.map((n: { id: string }) => n.id)).toEqual(['a']);
    });

    it('works without a base (add/add conflict): union of both sides', () => {
        const ours = J({ notes: [note('b', 'B')], folders: [] });
        const theirs = J({ notes: [note('c', 'C')], folders: [] });

        const merged = parse(mergeStoreFile(basePath, undefined, ours, theirs)!.text);
        expect(merged.notes.map((n: { id: string }) => n.id)).toEqual(['b', 'c']);
    });
});

describe('mergeStoreFile — todos (optional ids)', () => {
    const path = 'data/default/todo_db/todos.json';
    const todo = (note: string, id?: string) => ({ id, note, date: '2026-06-12', done: false, tags: [] });

    it('merges by id when present and by value when not', () => {
        const base = J({ items: [todo('keep', 't1')] });
        const ours = J({ items: [todo('keep', 't1'), { note: 'local no-id', date: '2026-06-12', done: false, tags: [] }] });
        const theirs = J({ items: [todo('keep', 't1'), todo('remote', 't2')] });

        const merged = parse(mergeStoreFile(path, base, ours, theirs)!.text);
        expect(merged.items).toHaveLength(3);
    });

    it('done-toggle on one side survives', () => {
        const base = J({ items: [todo('x', 't1')] });
        const ours = J({ items: [{ ...todo('x', 't1'), done: true }] });
        const theirs = J({ items: [todo('x', 't1'), todo('new', 't2')] });

        const merged = parse(mergeStoreFile(path, base, ours, theirs)!.text);
        expect(merged.items.find((i: { id: string }) => i.id === 't1').done).toBe(true);
        expect(merged.items).toHaveLength(2);
    });
});

describe('mergeStoreFile — tags record', () => {
    const path = 'data/default/tags_db/tags.json';

    it('unions keys and keeps single-side recolors', () => {
        const base = J({ tags: { '#a': { color: '#111111', category: 'general' } } });
        const ours = J({ tags: {
            '#a': { color: '#222222', category: 'general' },
            '#local': { color: '#333333', category: 'general' },
        } });
        const theirs = J({ tags: {
            '#a': { color: '#111111', category: 'general' },
            '#remote': { color: '#444444', category: 'general' },
        } });

        const merged = parse(mergeStoreFile(path, base, ours, theirs)!.text);
        expect(Object.keys(merged.tags).sort()).toEqual(['#a', '#local', '#remote']);
        expect(merged.tags['#a'].color).toBe('#222222');
    });
});

describe('mergeStoreFile — links tree', () => {
    const path = 'data/default/links_db/links.json';

    it('merges children added in the same folder on both sides', () => {
        const folder = (children: unknown[]) => ({
            id: 'f1', type: 'folder', label: 'Folder', children,
        });
        const link = (id: string, label: string) => ({ id, type: 'link', label, url: 'https://x' });

        const base = J({ root: [folder([link('l1', 'one')])] });
        const ours = J({ root: [folder([link('l1', 'one'), link('l2', 'local')])] });
        const theirs = J({ root: [folder([link('l1', 'one'), link('l3', 'remote')])] });

        const merged = parse(mergeStoreFile(path, base, ours, theirs)!.text);
        expect(merged.root[0].children.map((c: { id: string }) => c.id)).toEqual(['l1', 'l2', 'l3']);
    });
});

describe('mergeStoreFile — records', () => {
    const path = 'data/default/records_db/2026/06.json';

    it('unions per-day entries', () => {
        const base = J({ year: 2026, month: 6, days: { '11': [{ time_spent_min: 30, notes: 'old' }] } });
        const ours = J({ year: 2026, month: 6, days: {
            '11': [{ time_spent_min: 30, notes: 'old' }],
            '12': [{ time_spent_min: 60, notes: 'local work' }],
        } });
        const theirs = J({ year: 2026, month: 6, days: {
            '11': [{ time_spent_min: 30, notes: 'old' }, { time_spent_min: 15, notes: 'remote extra' }],
        } });

        const merged = parse(mergeStoreFile(path, base, ours, theirs)!.text);
        expect(merged.days['11']).toHaveLength(2);
        expect(merged.days['12']).toHaveLength(1);
    });
});

describe('mergeStoreFile — pipe scopes', () => {
    const path = 'data/default/pipe_db/scopes.json';

    it('merges scopes by id and rules by name', () => {
        const scope = (id: string, label: string) => ({
            id, label, projects: ['g/p'], enabled: true, follow: false, tags: [],
        });
        const base = J({ scopes: [scope('s1', 'A')], logRules: [] });
        const ours = J({ scopes: [scope('s1', 'A'), scope('s2', 'Local')], logRules: [] });
        const theirs = J({ scopes: [scope('s1', 'A')], logRules: [{ name: 'r', pattern: 'x', mode: 'remove' }] });

        const merged = parse(mergeStoreFile(path, base, ours, theirs)!.text);
        expect(merged.scopes.map((s: { id: string }) => s.id)).toEqual(['s1', 's2']);
        expect(merged.logRules).toHaveLength(1);
    });
});

describe('mergeStoreFile — guard rails', () => {
    it('refuses unknown files', () => {
        expect(mergeStoreFile('data/default/notes/todos.md', 'a', 'b', 'c')).toBeUndefined();
        expect(isMergeableStore('data/default/notes/todos.md')).toBe(false);
        expect(isMergeableStore('data/default/lists_db/lists.json')).toBe(true);
    });

    it('refuses invalid JSON sides', () => {
        const path = 'data/default/todo_db/todos.json';
        expect(mergeStoreFile(path, '{}', '{not json', '{"items":[]}')).toBeUndefined();
        expect(mergeStoreFile(path, '{}', '{"items":[]}', 'garbage')).toBeUndefined();
    });

    it('handles windows path separators', () => {
        const out = mergeStoreFile(
            'data\\default\\todo_db\\todos.json',
            J({ items: [] }), J({ items: [] }), J({ items: [] }),
        );
        expect(out).toBeDefined();
    });
});

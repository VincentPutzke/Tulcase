import { describe, it, expect } from 'vitest';
import { mergeStoreFile, isMergeableStore } from '../sync/data-merge';

const J = (v: unknown) => JSON.stringify(v, null, 2);
const parse = (text: string) => JSON.parse(text);

const scriptPath = 'data/default/scripts_db/scripts.json';

const sc = (id: string, label: string, updatedAt = '2026-06-01') => ({
    id, label, tags: [] as string[], folder: '',
    createdAt: '2026-06-01', updatedAt,
});

describe('mergeStoreFile — scripts.json', () => {
    it('is recognised as a mergeable store', () => {
        expect(isMergeableStore(scriptPath)).toBe(true);
    });

    it('merges a script added on each side', () => {
        const base = J({ items: [sc('a', 'A')], folders: [] });
        const ours = J({ items: [sc('a', 'A'), sc('b', 'B-local')], folders: [] });
        const theirs = J({ items: [sc('a', 'A'), sc('c', 'C-remote')], folders: [] });

        const merged = parse(mergeStoreFile(scriptPath, base, ours, theirs)!.text);
        expect(merged.items.map((s: { id: string }) => s.id)).toEqual(['a', 'b', 'c']);
    });

    it('merges folders added on each side', () => {
        const base = J({ items: [], folders: [{ id: 'f1', name: 'One', parent: '' }] });
        const ours = J({ items: [], folders: [{ id: 'f1', name: 'One', parent: '' }, { id: 'f2', name: 'Two', parent: '' }] });
        const theirs = J({ items: [], folders: [{ id: 'f1', name: 'One', parent: '' }, { id: 'f3', name: 'Three', parent: '' }] });

        const merged = parse(mergeStoreFile(scriptPath, base, ours, theirs)!.text);
        expect(merged.folders.map((f: { id: string }) => f.id)).toEqual(['f1', 'f2', 'f3']);
    });

    it('newer updatedAt wins a same-script double edit', () => {
        const base = J({ items: [sc('a', 'A')], folders: [] });
        const ours = J({ items: [sc('a', 'A-local', '2026-06-02')], folders: [] });
        const theirs = J({ items: [sc('a', 'A-remote', '2026-06-03')], folders: [] });

        const out = mergeStoreFile(scriptPath, base, ours, theirs)!;
        expect(parse(out.text).items[0].label).toBe('A-remote');
        expect(out.softConflicts).toBe(1);
    });
});

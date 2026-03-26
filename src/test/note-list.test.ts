import { describe, it, expect } from 'vitest';
import type {
    NoteItem,
    NoteFolder,
    NoteStore,
    LegacyListStore,
    LegacyMiniList,
} from '../models/note.model';

// ── Unit-testable helpers extracted from note-list.view.ts ────────────────────
// Pure functions re-implemented here for testing without VS Code dependencies.

/** Convert legacy MiniList[] data to the new NoteItem[] format. */
function migrateLegacy(legacy: LegacyListStore): NoteStore {
    const notes: NoteItem[] = [];

    for (const list of legacy.lists) {
        const lines: string[] = [];

        if (list.description) {
            lines.push(list.description);
            lines.push('');
        }

        for (const item of list.items) {
            const prefix = item.done ? '- [x]' : '- [ ]';
            lines.push(`${prefix} ${item.text}`);
        }

        notes.push({
            id: list.id,
            label: list.label,
            content: lines.join('\n'),
            tags: list.tags ?? [],
            folder: '',
            createdAt: list.createdAt,
            updatedAt: list.createdAt,
        });
    }

    return { notes, folders: [] };
}

/** Build children map: parentId → child folders. */
function buildFolderTree(folders: NoteFolder[]): Record<string, NoteFolder[]> {
    const children: Record<string, NoteFolder[]> = {};
    for (const f of folders) {
        const pid = f.parent || '';
        if (!children[pid]) { children[pid] = []; }
        children[pid].push(f);
    }
    for (const key in children) {
        children[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return children;
}

/** Get notes belonging to a specific folder. */
function notesInFolder(notes: NoteItem[], folderId: string): NoteItem[] {
    return notes.filter(n => (n.folder || '') === folderId);
}

/** Count non-empty lines in a string. */
function lineCount(text: string): number {
    if (!text) { return 0; }
    return text.split('\n').length;
}

// ── Formatting helpers (from note-format.ts logic) ────────────────────────────

/** Normalise bullet: `* ` → `- `. */
function normaliseBullet(line: string): string {
    return line.replace(/^(\s*)\*(\s)/, '$1-$2');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NoteStore helpers', () => {
    // ── Migration ─────────────────────────────────────────

    describe('migrateLegacy', () => {
        it('converts MiniList[] to NoteItem[] with markdown task syntax', () => {
            const legacy: LegacyListStore = {
                lists: [
                    {
                        id: 'ml_1',
                        label: 'Shopping',
                        description: 'Weekly groceries',
                        tags: ['#home'],
                        createdAt: '2025-01-01',
                        items: [
                            { id: 'li_1', text: 'Milk', done: false, tags: [], createdAt: '2025-01-01' },
                            { id: 'li_2', text: 'Bread', done: true, tags: [], createdAt: '2025-01-01' },
                        ],
                    },
                ],
            };

            const result = migrateLegacy(legacy);

            expect(result.notes).toHaveLength(1);
            expect(result.folders).toHaveLength(0);

            const note = result.notes[0];
            expect(note.id).toBe('ml_1');
            expect(note.label).toBe('Shopping');
            expect(note.tags).toEqual(['#home']);
            expect(note.content).toContain('Weekly groceries');
            expect(note.content).toContain('- [ ] Milk');
            expect(note.content).toContain('- [x] Bread');
        });

        it('handles empty lists', () => {
            const legacy: LegacyListStore = {
                lists: [],
            };

            const result = migrateLegacy(legacy);
            expect(result.notes).toHaveLength(0);
            expect(result.folders).toHaveLength(0);
        });

        it('handles list without description', () => {
            const legacy: LegacyListStore = {
                lists: [
                    {
                        id: 'ml_2',
                        label: 'Tasks',
                        description: '',
                        tags: [],
                        createdAt: '2025-02-01',
                        items: [
                            { id: 'li_3', text: 'Do homework', done: false, tags: [], createdAt: '2025-02-01' },
                        ],
                    },
                ],
            };

            const result = migrateLegacy(legacy);
            const note = result.notes[0];
            expect(note.content).toBe('- [ ] Do homework');
            // No leading description + blank line
            expect(note.content).not.toContain('\n\n');
        });

        it('preserves createdAt as both createdAt and updatedAt', () => {
            const legacy: LegacyListStore = {
                lists: [
                    {
                        id: 'ml_3',
                        label: 'Test',
                        description: '',
                        tags: [],
                        createdAt: '2025-03-15',
                        items: [],
                    },
                ],
            };

            const result = migrateLegacy(legacy);
            expect(result.notes[0].createdAt).toBe('2025-03-15');
            expect(result.notes[0].updatedAt).toBe('2025-03-15');
        });
    });

    // ── Folder tree ───────────────────────────────────────

    describe('buildFolderTree', () => {
        it('groups folders by parent ID', () => {
            const folders: NoteFolder[] = [
                { id: 'nf_1', name: 'Work', parent: '' },
                { id: 'nf_2', name: 'Personal', parent: '' },
                { id: 'nf_3', name: 'Projects', parent: 'nf_1' },
            ];

            const tree = buildFolderTree(folders);

            expect(tree['']).toHaveLength(2);
            expect(tree['nf_1']).toHaveLength(1);
            expect(tree['nf_1'][0].name).toBe('Projects');
        });

        it('sorts folders alphabetically within each group', () => {
            const folders: NoteFolder[] = [
                { id: 'nf_1', name: 'Zebra', parent: '' },
                { id: 'nf_2', name: 'Alpha', parent: '' },
                { id: 'nf_3', name: 'Mid', parent: '' },
            ];

            const tree = buildFolderTree(folders);
            const rootNames = tree[''].map(f => f.name);
            expect(rootNames).toEqual(['Alpha', 'Mid', 'Zebra']);
        });

        it('returns empty object for no folders', () => {
            const tree = buildFolderTree([]);
            expect(Object.keys(tree)).toHaveLength(0);
        });
    });

    // ── Note filtering ────────────────────────────────────

    describe('notesInFolder', () => {
        const notes: NoteItem[] = [
            { id: 'nt_1', label: 'A', content: '', tags: [], folder: '', createdAt: '', updatedAt: '' },
            { id: 'nt_2', label: 'B', content: '', tags: [], folder: 'nf_1', createdAt: '', updatedAt: '' },
            { id: 'nt_3', label: 'C', content: '', tags: [], folder: 'nf_1', createdAt: '', updatedAt: '' },
        ];

        it('returns root notes for empty folder ID', () => {
            expect(notesInFolder(notes, '')).toHaveLength(1);
            expect(notesInFolder(notes, '')[0].label).toBe('A');
        });

        it('returns notes in a specific folder', () => {
            expect(notesInFolder(notes, 'nf_1')).toHaveLength(2);
        });

        it('returns empty for unknown folder', () => {
            expect(notesInFolder(notes, 'nf_999')).toHaveLength(0);
        });
    });

    // ── Line count ────────────────────────────────────────

    describe('lineCount', () => {
        it('returns 0 for empty string', () => {
            expect(lineCount('')).toBe(0);
        });

        it('counts single line', () => {
            expect(lineCount('hello')).toBe(1);
        });

        it('counts multiple lines', () => {
            expect(lineCount('a\nb\nc')).toBe(3);
        });
    });

    // ── Formatting ────────────────────────────────────────

    describe('normaliseBullet', () => {
        it('converts * to -', () => {
            expect(normaliseBullet('* item')).toBe('- item');
        });

        it('preserves indented bullets', () => {
            expect(normaliseBullet('  * nested')).toBe('  - nested');
        });

        it('leaves - bullets unchanged', () => {
            expect(normaliseBullet('- item')).toBe('- item');
        });

        it('leaves non-bullet lines unchanged', () => {
            expect(normaliseBullet('Just text')).toBe('Just text');
        });
    });
});

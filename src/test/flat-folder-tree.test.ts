import { describe, expect, it } from 'vitest';
import {
    isFolderDescendant,
    moveFlatFolder,
    moveFlatItem,
    type FlatFolderNode,
    type FlatItemNode,
} from '../data/flat-folder-tree';

interface TestFolder extends FlatFolderNode {
    name: string;
}

interface TestItem extends FlatItemNode {
    label: string;
}

function buildFolders(): TestFolder[] {
    return [
        { id: 'f1', name: 'Work', parent: '' },
        { id: 'f2', name: 'Docs', parent: 'f1' },
        { id: 'f3', name: 'Ops', parent: '' },
    ];
}

function buildItems(): TestItem[] {
    return [
        { id: 'i1', label: 'Alpha', folder: '' },
        { id: 'i2', label: 'Bravo', folder: 'f1' },
    ];
}

describe('flat-folder-tree helpers', () => {
    describe('isFolderDescendant', () => {
        it('detects nested descendants', () => {
            expect(isFolderDescendant(buildFolders(), 'f1', 'f2')).toBe(true);
        });

        it('returns false for root target', () => {
            expect(isFolderDescendant(buildFolders(), 'f1', '')).toBe(false);
        });
    });

    describe('moveFlatFolder', () => {
        it('moves a folder to root', () => {
            const folders = buildFolders();
            expect(moveFlatFolder(folders, 'f2', '')).toBe(true);
            expect(folders.find(folder => folder.id === 'f2')?.parent).toBe('');
        });

        it('moves a folder into another folder', () => {
            const folders = buildFolders();
            expect(moveFlatFolder(folders, 'f3', 'f1')).toBe(true);
            expect(folders.find(folder => folder.id === 'f3')?.parent).toBe('f1');
        });

        it('rejects moves into a descendant', () => {
            const folders = buildFolders();
            expect(moveFlatFolder(folders, 'f1', 'f2')).toBe(false);
            expect(folders.find(folder => folder.id === 'f1')?.parent).toBe('');
        });
    });

    describe('moveFlatItem', () => {
        it('moves an item into a folder', () => {
            const folders = buildFolders();
            const items = buildItems();
            expect(moveFlatItem(items, folders, 'i1', 'f3')).toBe(true);
            expect(items.find(item => item.id === 'i1')?.folder).toBe('f3');
        });

        it('moves an item back to root', () => {
            const folders = buildFolders();
            const items = buildItems();
            expect(moveFlatItem(items, folders, 'i2', '')).toBe(true);
            expect(items.find(item => item.id === 'i2')?.folder).toBe('');
        });

        it('rejects unknown target folders', () => {
            const folders = buildFolders();
            const items = buildItems();
            expect(moveFlatItem(items, folders, 'i1', 'missing')).toBe(false);
            expect(items.find(item => item.id === 'i1')?.folder).toBe('');
        });
    });
});
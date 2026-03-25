import { describe, it, expect } from 'vitest';
import { findNode, removeNode, countLinks } from '../data/link-tree';
import type { LinkNode } from '../models/link.model';

function buildTree(): LinkNode[] {
    return [
        {
            id: 'f1', type: 'folder', label: 'Dev', children: [
                { id: 'l1', type: 'link', label: 'GitHub', url: 'https://github.com', tags: [] },
                { id: 'l2', type: 'link', label: 'SO', url: 'https://stackoverflow.com', tags: [] },
                {
                    id: 'f2', type: 'folder', label: 'Docs', children: [
                        { id: 'l3', type: 'link', label: 'MDN', url: 'https://developer.mozilla.org', tags: [] },
                    ]
                },
            ]
        },
        { id: 'l4', type: 'link', label: 'Google', url: 'https://google.com', tags: [] },
    ];
}

describe('findNode', () => {
    it('finds root-level node', () => {
        const tree = buildTree();
        const node = findNode(tree, 'l4');
        expect(node?.label).toBe('Google');
    });

    it('finds deeply nested node', () => {
        const tree = buildTree();
        const node = findNode(tree, 'l3');
        expect(node?.label).toBe('MDN');
    });

    it('returns null for missing ID', () => {
        const tree = buildTree();
        expect(findNode(tree, 'nonexistent')).toBeNull();
    });

    it('finds folder node', () => {
        const tree = buildTree();
        const node = findNode(tree, 'f1');
        expect(node?.label).toBe('Dev');
        expect(node?.type).toBe('folder');
    });
});

describe('removeNode', () => {
    it('removes and returns root-level node', () => {
        const tree = buildTree();
        const removed = removeNode(tree, 'l4');
        expect(removed?.label).toBe('Google');
        expect(tree.length).toBe(1);
    });

    it('removes nested node', () => {
        const tree = buildTree();
        const removed = removeNode(tree, 'l1');
        expect(removed?.label).toBe('GitHub');
        expect(tree[0].children?.length).toBe(2); // l2 + f2 remain
    });

    it('returns null for missing ID', () => {
        const tree = buildTree();
        expect(removeNode(tree, 'nonexistent')).toBeNull();
    });
});

describe('countLinks', () => {
    it('counts link types only', () => {
        const tree = buildTree();
        expect(countLinks(tree)).toBe(4); // l1, l2, l3, l4
    });

    it('returns 0 for empty tree', () => {
        expect(countLinks([])).toBe(0);
    });

    it('counts single link', () => {
        expect(countLinks([{ id: 'l1', type: 'link', label: 'Test' }])).toBe(1);
    });
});

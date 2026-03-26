import { describe, it, expect } from 'vitest';
import { findNode, removeNode, countLinks } from '../data/link-tree';
import type { LinkNode } from '../models/link.model';

// ── Test data builder ─────────────────────────────────────────────────────────

function buildTree(): LinkNode[] {
    return [
        {
            id: 'f1', type: 'folder', label: 'Dev', children: [
                { id: 'l1', type: 'link', label: 'GitHub', url: 'https://github.com', tags: ['#dev'] },
                { id: 'l2', type: 'link', label: 'SO', url: 'https://stackoverflow.com', tags: [] },
                {
                    id: 'f2', type: 'folder', label: 'Docs', children: [
                        { id: 'l3', type: 'link', label: 'MDN', url: 'https://developer.mozilla.org', tags: ['#docs'] },
                    ]
                },
            ]
        },
        { id: 'l4', type: 'link', label: 'Google', url: 'https://google.com', tags: ['#search'] },
    ];
}

// ── Pure helpers extracted from webview JS for testability ─────────────────────

/** Test whether a link node matches a search query. */
function matchesQuery(node: LinkNode, query: string): boolean {
    if (!query) { return true; }
    const q = query.toLowerCase();
    if (node.label.toLowerCase().includes(q)) { return true; }
    if (node.url && node.url.toLowerCase().includes(q)) { return true; }
    if (node.tags && node.tags.some(t => t.toLowerCase().includes(q))) { return true; }
    return false;
}

/** Check if a folder (or any descendant) has a matching node. */
function folderHasMatch(node: LinkNode, query: string): boolean {
    if (!query) { return true; }
    if (node.type === 'link') { return matchesQuery(node, query); }
    if (node.children) {
        for (const child of node.children) {
            if (folderHasMatch(child, query)) { return true; }
        }
    }
    return false;
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

// ── Search / filter helpers ───────────────────────────────────────────────────

describe('matchesQuery', () => {
    it('matches everything when query is empty', () => {
        const node: LinkNode = { id: 'l1', type: 'link', label: 'GitHub', url: 'https://github.com', tags: [] };
        expect(matchesQuery(node, '')).toBe(true);
    });

    it('matches by label (case-insensitive)', () => {
        const node: LinkNode = { id: 'l1', type: 'link', label: 'GitHub', url: 'https://github.com', tags: [] };
        expect(matchesQuery(node, 'git')).toBe(true);
        expect(matchesQuery(node, 'GITHUB')).toBe(true);
    });

    it('matches by URL', () => {
        const node: LinkNode = { id: 'l1', type: 'link', label: 'GitHub', url: 'https://github.com', tags: [] };
        expect(matchesQuery(node, 'github.com')).toBe(true);
    });

    it('matches by tag', () => {
        const node: LinkNode = { id: 'l1', type: 'link', label: 'GitHub', url: 'https://github.com', tags: ['#dev'] };
        expect(matchesQuery(node, '#dev')).toBe(true);
    });

    it('returns false for non-matching query', () => {
        const node: LinkNode = { id: 'l1', type: 'link', label: 'GitHub', url: 'https://github.com', tags: [] };
        expect(matchesQuery(node, 'stackoverflow')).toBe(false);
    });
});

describe('folderHasMatch', () => {
    it('returns true when query is empty', () => {
        const folder: LinkNode = { id: 'f1', type: 'folder', label: 'Dev', children: [] };
        expect(folderHasMatch(folder, '')).toBe(true);
    });

    it('finds match in nested children', () => {
        const tree = buildTree();
        // 'f1' folder contains 'GitHub' → should match "git"
        expect(folderHasMatch(tree[0], 'git')).toBe(true);
    });

    it('finds match in deeply nested children', () => {
        const tree = buildTree();
        // 'f1' → 'f2' → 'MDN' → should match "mdn"
        expect(folderHasMatch(tree[0], 'mdn')).toBe(true);
    });

    it('returns false when no descendant matches', () => {
        const tree = buildTree();
        expect(folderHasMatch(tree[0], 'zzzzz')).toBe(false);
    });

    it('matches folder child by tag', () => {
        const tree = buildTree();
        expect(folderHasMatch(tree[0], '#docs')).toBe(true);
    });
});

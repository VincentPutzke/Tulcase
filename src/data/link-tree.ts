import type { LinkNode } from '../models/link.model';

/**
 * Recursively find a node by ID in the link tree.
 */
export function findNode(nodes: LinkNode[], nodeId: string): LinkNode | null {
    for (const n of nodes) {
        if (n.id === nodeId) {
            return n;
        }
        if (n.type === 'folder' && n.children) {
            const found = findNode(n.children, nodeId);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

/**
 * Recursively remove a node by ID. Returns the removed node or null.
 */
export function removeNode(nodes: LinkNode[], nodeId: string): LinkNode | null {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === nodeId) {
            return nodes.splice(i, 1)[0];
        }
        if (nodes[i].type === 'folder' && nodes[i].children) {
            const found = removeNode(nodes[i].children!, nodeId);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

function findParentId(nodes: LinkNode[], nodeId: string, parentId = ''): string | null {
    for (const n of nodes) {
        if (n.id === nodeId) {
            return parentId;
        }
        if (n.type === 'folder' && n.children) {
            const found = findParentId(n.children, nodeId, n.id);
            if (found !== null) {
                return found;
            }
        }
    }
    return null;
}

function hasDescendant(node: LinkNode, descendantId: string): boolean {
    if (node.id === descendantId) {
        return true;
    }
    if (node.type !== 'folder' || !node.children) {
        return false;
    }
    return node.children.some(child => hasDescendant(child, descendantId));
}

export function moveNode(nodes: LinkNode[], nodeId: string, targetFolderId: string): boolean {
    const node = findNode(nodes, nodeId);
    if (!node) { return false; }

    const currentParentId = findParentId(nodes, nodeId);
    if (currentParentId === null) { return false; }
    if (currentParentId === targetFolderId) { return false; }
    if (targetFolderId === nodeId) { return false; }

    if (targetFolderId) {
        const target = findNode(nodes, targetFolderId);
        if (!target || target.type !== 'folder') {
            return false;
        }
        if (node.type === 'folder' && hasDescendant(node, targetFolderId)) {
            return false;
        }
    }

    const removed = removeNode(nodes, nodeId);
    if (!removed) { return false; }

    if (!targetFolderId) {
        nodes.push(removed);
        return true;
    }

    const target = findNode(nodes, targetFolderId);
    if (!target || target.type !== 'folder') {
        nodes.push(removed);
        return false;
    }

    target.children ??= [];
    target.children.push(removed);
    target.expanded = true;
    return true;
}

/**
 * Count total link items in a tree (ignoring folders).
 */
export function countLinks(nodes: LinkNode[]): number {
    let total = 0;
    for (const n of nodes) {
        if (n.type === 'link') {
            total++;
        } else if (n.type === 'folder' && n.children) {
            total += countLinks(n.children);
        }
    }
    return total;
}

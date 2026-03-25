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

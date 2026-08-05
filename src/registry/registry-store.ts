/**
 * Session cache of loaded children per Registry tree node id.
 *
 * The Packages tree loads children lazily on expand and caches them here so
 * re-expanding is instant. The cache lives for the process only — a reload
 * starts empty (all nodes collapsed), matching the subscription manager.
 *
 * Node ids are path-like (`scope:s1/group:g/project:p`), so invalidating a node
 * drops its whole descendant subtree by prefix — the same prune rule the
 * subscription manager uses on collapse.
 *
 * Pure (no VS Code) — unit-testable.
 */

import type { RegistryNode } from './registry-tree';
import { isSelfOrDescendant } from './node-id';

export interface CachedChildren {
    nodes: RegistryNode[];
    /** Wall-clock ms when these children were loaded. */
    loadedAt: number;
    /** Set when the load failed — the view shows an expand-error + retry. */
    error?: string;
}

export class RegistryStore {
    private readonly _children = new Map<string, CachedChildren>();

    constructor(private readonly now: () => number = () => Date.now()) {}

    get(nodeId: string): CachedChildren | undefined {
        return this._children.get(nodeId);
    }

    has(nodeId: string): boolean {
        return this._children.has(nodeId);
    }

    set(nodeId: string, nodes: RegistryNode[], error?: string): void {
        this._children.set(nodeId, { nodes, loadedAt: this.now(), error });
    }

    /** Drop a node's cached children and its entire descendant subtree. */
    invalidate(nodeId: string): void {
        for (const id of [...this._children.keys()]) {
            if (isSelfOrDescendant(id, nodeId)) { this._children.delete(id); }
        }
    }

    /** Wipe everything (webview re-created → fresh, all collapsed). */
    clear(): void {
        this._children.clear();
    }
}

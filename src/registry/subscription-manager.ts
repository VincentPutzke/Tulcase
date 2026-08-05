/**
 * Tracks which Registry tree nodes are currently expanded and therefore should
 * be polled in the background. The webview sends subscribe/unsubscribe deltas
 * as the user expands/collapses; the host owns this set so the two can't drift
 * (it is cleared whenever the webview is re-created). Polling is additionally
 * gated on the view being visible.
 *
 * Node ids are path-like (`scope:s1/group:g/project:p`), so a node's descendants
 * share its id as a prefix — collapsing a node unsubscribes its whole subtree.
 *
 * Pure (no VS Code) — unit-testable (ticket 11 seam).
 */
import { isSelfOrDescendant } from './node-id';

export class SubscriptionManager {
    private readonly _subs = new Set<string>();

    /** Expand a node → poll it. */
    subscribe(nodeId: string): void {
        this._subs.add(nodeId);
    }

    /** Collapse a node → stop polling it AND its entire descendant subtree. */
    unsubscribe(nodeId: string): void {
        for (const id of this._subs) {
            if (isSelfOrDescendant(id, nodeId)) { this._subs.delete(id); }
        }
    }

    /** Drop everything (webview re-created → all nodes start collapsed). */
    clear(): void {
        this._subs.clear();
    }

    has(nodeId: string): boolean {
        return this._subs.has(nodeId);
    }

    get size(): number {
        return this._subs.size;
    }

    /** Nodes to poll this tick — empty while the view is hidden. */
    active(visible: boolean): string[] {
        return visible ? [...this._subs] : [];
    }
}

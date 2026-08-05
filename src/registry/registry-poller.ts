/**
 * Expansion-driven background poller for the Packages tree (ticket 11).
 *
 * Only the currently-expanded nodes (the subscription set) are refreshed, and
 * only while the Packages view is visible. Collapsing a node unsubscribes its
 * whole subtree; re-creating the webview clears the set — both handled by the
 * {@link SubscriptionManager}. This poller just turns that set into periodic
 * re-fetches on the registry poll interval, honouring the client's global
 * concurrency ceiling (all fetches funnel through the shared client semaphore).
 */

import { PollerBase } from '../pipe/poller-base';
import type { SubscriptionManager } from './subscription-manager';
import type { RegistryNode } from './registry-tree';

export interface RegistryPollerConfig {
    pollIntervalSeconds: number;
}

export class RegistryPoller extends PollerBase {
    private _visible = false;

    constructor(
        private readonly getConfig: () => RegistryPollerConfig,
        private readonly subs: SubscriptionManager,
        /** Resolve a subscribed node id back to the node to re-fetch. */
        private readonly resolveNode: (nodeId: string) => RegistryNode | undefined,
        /** Re-fetch a node's children into the store + push to the view. */
        private readonly refreshNode: (node: RegistryNode, signal: AbortSignal) => Promise<void>,
    ) {
        super();
    }

    /** The Packages view became (in)visible — start/stop polling accordingly. */
    setVisible(visible: boolean): void {
        this._visible = visible;
        this._sync();
    }

    /** A subscribe/unsubscribe delta arrived — (de)activate as the set fills/empties. */
    onSubscriptionsChanged(): void {
        this._sync();
    }

    private _sync(): void {
        // Poll only while visible AND at least one node is expanded.
        this.setActive(this._visible && this.subs.size > 0);
    }

    protected intervalMs(): number {
        return this.getConfig().pollIntervalSeconds * 1000;
    }

    protected async tick(signal: AbortSignal): Promise<void> {
        const ids = this.subs.active(this._visible);
        // Refresh ancestors before descendants (fewer path segments = higher up),
        // so a project refresh repopulates its package groups before a subscribed
        // package under it is refreshed in the same tick.
        ids.sort((a, b) => a.split('/').length - b.split('/').length);
        for (const id of ids) {
            if (signal.aborted) { return; }
            const node = this.resolveNode(id);
            if (!node) { continue; }
            try {
                await this.refreshNode(node, signal);
            } catch (err) {
                this.raiseError(err);   // one bad node must not stop the tick
            }
        }
    }
}

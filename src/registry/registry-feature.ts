/**
 * Composition root for the Registry (Packages) feature.
 *
 * Mirrors {@link PipeFeature}: owns the store, service, poller, subscription
 * set, tag filter and the Packages view, and wires their lifecycles. It reuses
 * the Pipe feature's GitLab client, secret storage and scope store (one client,
 * one PAT, one scopes file — shared, per the spec) rather than constructing its
 * own.
 *
 * Implements {@link RegistryViewHost}: the view forwards user gestures here and
 * this pushes node data back. Background polling refreshes only expanded +
 * visible nodes; the subscription set is cleared whenever the webview is
 * re-created so host and webview can't drift.
 */

import * as vscode from 'vscode';
import type { TulcaseSettings } from '../config';
import type { TagTreeProvider } from '../providers/tag-tree.provider';
import { pickTags } from '../data/tag-picker';
import type { GitLabClient } from '../pipe/gitlab-client';
import { describeApiError } from '../pipe/gitlab-client';
import type { GitLabSecrets } from '../pipe/secrets';
import type { PipeScopeStore } from '../pipe/scope-store';
import { PipeTagFilter } from '../pipe/tag-filter';
import { getRegistryConfig, getPipeConfig, onPipeConfigChange } from '../pipe/pipe-config';
import { GITLAB_VIEWS, focusCommand } from '../pipe/view-ids';
import type { Subscription } from '../pipe/events';
import { buildScopeNodes, type RegistryNode } from './registry-tree';
import { RegistryStore } from './registry-store';
import { RegistryService } from './registry-service';
import { RegistryPoller } from './registry-poller';
import { SubscriptionManager } from './subscription-manager';
import { runVersionDownload } from './download-adapter';
import {
    GitlabPackagesViewProvider,
    type ChildrenResult,
    type RegistryViewHost,
    type RegistryInitState,
} from '../views/gitlab-packages.view';

/** Shared Pipe services the Registry reuses (one client / PAT / scopes file). */
export interface RegistrySharedDeps {
    client: GitLabClient;
    secrets: GitLabSecrets;
    scopeStore: PipeScopeStore;
}

const TAG_FILTER_KEY = 'tulcase.registry.tagFilter';

export class RegistryFeature implements vscode.Disposable, RegistryViewHost {
    private readonly store = new RegistryStore();
    private readonly subs = new SubscriptionManager();
    private readonly service: RegistryService;
    private readonly poller: RegistryPoller;
    private readonly tagFilter: PipeTagFilter;
    private readonly view: GitlabPackagesViewProvider;

    /** Every node sent to the webview, so the poller can resolve ids to nodes. */
    private readonly _nodeIndex = new Map<string, RegistryNode>();

    private readonly _eventSubs: Subscription[] = [];
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        context: vscode.ExtensionContext,
        settings: TulcaseSettings,
        private readonly tagTree: TagTreeProvider,
        private readonly shared: RegistrySharedDeps,
    ) {
        this.service = new RegistryService(shared.client, shared.scopeStore);
        this.tagFilter = new PipeTagFilter(context.workspaceState, TAG_FILTER_KEY);
        this.poller = new RegistryPoller(
            () => getRegistryConfig(),
            this.subs,
            id => this._nodeIndex.get(id),
            (node, signal) => this._pollNode(node, signal),
        );
        this.view = new GitlabPackagesViewProvider(settings, tagTree);
        this.view.bindHost(this);

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                GitlabPackagesViewProvider.viewType, this.view,
                { webviewOptions: { retainContextWhenHidden: true } },
            ),
        );

        this._registerCommands(context);

        // Registry-enabled scope set / tag filter changed → refresh the roots
        // and re-poll expanded nodes with fresh data.
        this._eventSubs.push(
            shared.scopeStore.onDidChange(() => { this.view.refreshRoots(); void this.poller.tickNow(); }),
            this.tagFilter.onDidChange(() => { this.view.refreshRoots(); }),
            this.poller.onError(err => this.view.toast(describeApiError(err), 'error')),
        );
        this._disposables.push(
            this.view,
            this.poller,
            this.tagFilter,
            onPipeConfigChange(() => { void this.poller.tickNow(); }),
        );
    }

    // ── RegistryViewHost ─────────────────────────────────────────────────────────

    async getInitState(): Promise<RegistryInitState> {
        const [hasToken, scopes, tagMap] = await Promise.all([
            this.shared.secrets.getToken().then(Boolean),
            this.shared.scopeStore.listScopes(),
            this.tagTree.getTagMap(),
        ]);
        return {
            hasToken,
            registryScopeCount: scopes.filter(s => s.registryEnabled).length,
            tagMap: tagMap as Record<string, { color?: string }>,
            selectedTags: this.tagFilter.selected,
        };
    }

    async loadRoots(): Promise<RegistryNode[]> {
        const scopes = await this.shared.scopeStore.listScopes();
        const nodes = buildScopeNodes(scopes.filter(s => this.tagFilter.matches(s)));
        this._index(nodes);
        return nodes;
    }

    async expand(nodeId: string): Promise<ChildrenResult> {
        const node = this._nodeIndex.get(nodeId);
        if (!node) { return { parentId: nodeId, nodes: [], error: 'This item is no longer available.' }; }
        this.subs.subscribe(nodeId);
        this.poller.onSubscriptionsChanged();

        const cached = this.store.get(nodeId);
        if (cached && !cached.error) { return { parentId: nodeId, nodes: cached.nodes }; }
        return this._loadInto(node);
    }

    collapse(nodeId: string): void {
        this.subs.unsubscribe(nodeId);       // drops the whole descendant subtree
        this.poller.onSubscriptionsChanged();
    }

    async refreshNode(nodeId: string): Promise<ChildrenResult> {
        const node = this._nodeIndex.get(nodeId);
        if (!node) { return { parentId: nodeId, nodes: [], error: 'This item is no longer available.' }; }
        this.service.invalidate(node);
        this.store.invalidate(nodeId);
        return this._loadInto(node);
    }

    async refreshAll(): Promise<RegistryNode[]> {
        this.service.invalidateAll();
        this.store.clear();
        this.subs.clear();
        this._nodeIndex.clear();
        this.poller.onSubscriptionsChanged();
        return this.loadRoots();
    }

    async download(nodeId: string): Promise<void> {
        const node = this._nodeIndex.get(nodeId);
        if (!node) { return; }
        await runVersionDownload(
            this.shared.client, node,
            () => this.shared.secrets.ensureToken('Package download'),
        );
    }

    async openInBrowser(nodeId: string): Promise<void> {
        const node = this._nodeIndex.get(nodeId);
        if (!node) { return; }
        const url = this._webUrl(node);
        if (url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
    }

    setVisible(visible: boolean): void {
        this.poller.setVisible(visible);
    }

    onWebviewDisposed(): void {
        this.subs.clear();
        this.store.clear();
        this._nodeIndex.clear();
        this.poller.setVisible(false);
        this.poller.onSubscriptionsChanged();
    }

    async setTagFilter(tags: string[]): Promise<void> {
        await this.tagFilter.setSelected(tags);
    }

    async pickTags(): Promise<void> {
        const picked = await pickTags(this.tagTree, this.tagFilter.selected);
        if (picked === undefined) { return; }
        await this.tagFilter.setSelected(picked);
        this.view.updateTagFilter(this.tagFilter.selected);
    }

    async setToken(): Promise<void> {
        await vscode.commands.executeCommand('tulcase.pipe.setToken');
    }

    async openScopes(): Promise<void> {
        await vscode.commands.executeCommand(focusCommand(GITLAB_VIEWS.scopes));
    }

    // ── Cross-feature refresh (sync cycles, DB switch, external file edits) ──────

    refresh(): void {
        this.view.refreshRoots();
    }

    // ── Internals ────────────────────────────────────────────────────────────────

    /** Fetch a node's children, cache them, index them, return them (or error). */
    private async _loadInto(node: RegistryNode): Promise<ChildrenResult> {
        try {
            const nodes = await this.service.loadChildren(node);
            this.store.set(node.id, nodes);
            this._index(nodes);
            return { parentId: node.id, nodes };
        } catch (err) {
            const msg = describeApiError(err);
            this.store.set(node.id, [], msg);
            return { parentId: node.id, nodes: [], error: msg };
        }
    }

    /** Background poll refresh — updates cache + view, PRESERVES cache on error. */
    private async _pollNode(node: RegistryNode, signal: AbortSignal): Promise<void> {
        const nodes = await this.service.loadChildren(node, signal);   // throw → poller.raiseError
        this.store.set(node.id, nodes);
        this._index(nodes);
        this.view.pushChildren({ parentId: node.id, nodes });
    }

    private _index(nodes: RegistryNode[]): void {
        for (const n of nodes) { this._nodeIndex.set(n.id, n); }
    }

    private _webUrl(node: RegistryNode): string | undefined {
        const base = getPipeConfig().url;
        if (node.kind === 'version' && node.projectRef && node.packageId != null) {
            return `${base}/${node.projectRef}/-/packages/${node.packageId}`;
        }
        if ((node.kind === 'package' || node.kind === 'project') && node.projectRef) {
            return `${base}/${node.projectRef}/-/packages`;
        }
        if (node.kind === 'group' && node.groupRef) {
            return `${base}/groups/${node.groupRef}/-/packages`;
        }
        return undefined;
    }

    private _registerCommands(context: vscode.ExtensionContext): void {
        context.subscriptions.push(
            vscode.commands.registerCommand('tulcase.gitlab.registry.refreshAll', () => {
                void this.view.reloadAll();
            }),
            vscode.commands.registerCommand('tulcase.gitlab.registry.refreshNode', (nodeId?: string) => {
                if (nodeId) { void this.refreshNode(nodeId).then(r => this.view.pushChildren(r)); }
            }),
            vscode.commands.registerCommand('tulcase.gitlab.registry.downloadVersion', (nodeId?: string) => {
                if (nodeId) { void this.download(nodeId); }
            }),
            vscode.commands.registerCommand('tulcase.gitlab.registry.openInBrowser', (nodeId?: string) => {
                if (nodeId) { void this.openInBrowser(nodeId); }
            }),
        );
    }

    dispose(): void {
        for (const s of this._eventSubs) { s.dispose(); }
        for (const d of this._disposables) { d.dispose(); }
    }
}

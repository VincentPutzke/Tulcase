import * as vscode from 'vscode';
import { GITLAB_VIEWS } from '../pipe/view-ids';
import type { RegistryNode } from '../registry/registry-tree';
import { BaseListViewProvider } from './base-list.view';

/** Per-node children payload the host resolves for the tree. */
export interface ChildrenResult {
    parentId: string;
    nodes: RegistryNode[];
    /** Set when the load failed — the view renders an expand-error + retry. */
    error?: string;
}

/** Empty-state / filter context sent once per data refresh. */
export interface RegistryInitState {
    hasToken: boolean;
    registryScopeCount: number;
    tagMap: Record<string, { color?: string }>;
    selectedTags: string[];
}

/**
 * The Registry feature implements this — the view is a thin router that
 * forwards user gestures (expand/collapse/refresh/download) and pushes the
 * resulting node data back to the webview. All caching, fetching, polling and
 * subscription bookkeeping live in the feature.
 */
export interface RegistryViewHost {
    getInitState(): Promise<RegistryInitState>;
    loadRoots(): Promise<RegistryNode[]>;
    expand(nodeId: string): Promise<ChildrenResult>;
    collapse(nodeId: string): void;
    refreshNode(nodeId: string): Promise<ChildrenResult>;
    refreshAll(): Promise<RegistryNode[]>;
    download(nodeId: string): Promise<void>;
    openInBrowser(nodeId: string): Promise<void>;
    setVisible(visible: boolean): void;
    onWebviewDisposed(): void;
    setTagFilter(tags: string[]): Promise<void>;
    pickTags(): Promise<void>;
    setToken(): Promise<void>;
    openScopes(): Promise<void>;
}

/**
 * Packages view — the Registry browse tree in the "Tulcase GitLab" container.
 *
 * Renders a lazy, node-keyed tree (incremental DOM in the webview) of
 * registry-enabled scopes → group/project folders → packages → versions, with
 * per-version download. Expanding a node subscribes it to background polling;
 * collapsing unsubscribes its subtree. Reuses the tag + free-text filters.
 */
export class GitlabPackagesViewProvider extends BaseListViewProvider implements vscode.Disposable {
    public static readonly viewType = GITLAB_VIEWS.packages;
    protected readonly viewName = 'gitlab-packages';
    protected override readonly sidebarMode = true;

    private _host: RegistryViewHost | undefined;

    /** Wire the feature in after construction (avoids a construction cycle). */
    bindHost(host: RegistryViewHost): void {
        this._host = host;
    }

    override resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ): void {
        super.resolveWebviewView(webviewView, context, token);
        this._host?.setVisible(webviewView.visible);
        webviewView.onDidChangeVisibility(() => this._host?.setVisible(webviewView.visible));
        // Re-created webview → host resets subscriptions + cache (no drift).
        webviewView.onDidDispose(() => this._host?.onWebviewDisposed());
    }

    // ── Messages ───────────────────────────────────────────────────────────────

    protected async _handleMessage(msg: {
        type: string;
        nodeId?: string;
        tags?: string[];
    }): Promise<void> {
        const host = this._host;
        if (!host) { return; }
        switch (msg.type) {
            case 'requestData':
                await this._sendData();
                break;
            case 'expand':
                if (msg.nodeId) { this._post({ type: 'children', ...(await host.expand(msg.nodeId)) }); }
                break;
            case 'collapse':
                if (msg.nodeId) { host.collapse(msg.nodeId); }
                break;
            case 'refreshNode':
                if (msg.nodeId) { this._post({ type: 'children', ...(await host.refreshNode(msg.nodeId)) }); }
                break;
            case 'refreshAll':
                await this.reloadAll();
                break;
            case 'download':
                if (msg.nodeId) { await host.download(msg.nodeId); }
                break;
            case 'openInBrowser':
                if (msg.nodeId) { await host.openInBrowser(msg.nodeId); }
                break;
            case 'setTagFilter':
                await host.setTagFilter(Array.isArray(msg.tags) ? msg.tags : []);
                break;
            case 'pickTags':
                await host.pickTags();
                break;
            case 'setToken':
                await host.setToken();
                break;
            case 'openScopes':
                await host.openScopes();
                break;
        }
    }

    // ── Data push ──────────────────────────────────────────────────────────────

    protected async _sendData(): Promise<void> {
        const host = this._host;
        if (!this._view || !host) { return; }
        const [state, roots] = await Promise.all([host.getInitState(), host.loadRoots()]);
        this._post({ type: 'init', ...state });
        this._post({ type: 'roots', nodes: roots });
    }

    /** Full reset: invalidate caches (via host) and repaint from fresh roots.
     *  Invoked by the webview's "refresh all" and the view/title toolbar button. */
    async reloadAll(): Promise<void> {
        const host = this._host;
        if (!this._view || !host) { return; }
        const [state, roots] = await Promise.all([host.getInitState(), host.refreshAll()]);
        this._post({ type: 'init', ...state });
        this._post({ type: 'roots', nodes: roots });
    }

    // ── Feature → view pushes ────────────────────────────────────────────────────

    /** Re-fetched children arrived from a background poll — patch in place. */
    pushChildren(result: ChildrenResult): void {
        this._post({ type: 'children', ...result });
    }

    /** Registry-enabled scope set changed (edit/sync) — resend init + roots. */
    refreshRoots(): void {
        if (this._view?.visible) { void this._sendData(); }
    }

    /** Result of a native tag pick → update the webview's filter chips. */
    updateTagFilter(tags: string[]): void {
        this._post({ type: 'tagFilter', tags });
    }

    toast(text: string, kind: 'info' | 'error' = 'info'): void {
        this._post({ type: 'toast', text, kind });
    }

    private _post(message: unknown): void {
        void this._view?.webview.postMessage(message);
    }

    dispose(): void {
        // Providers own no disposables beyond the webview (managed by VS Code).
    }
}

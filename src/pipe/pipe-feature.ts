/**
 * Composition root for the Tulcase Pipe feature.
 *
 * Owns every pipe component (client, stores, pollers, log plumbing, views,
 * notifier, status bar), wires their lifecycles, and picks the polling mode:
 *
 *   - Pipelines view visible            → poll all enabled scopes
 *   - hidden, but followed scopes exist → poll only followed scopes
 *   - otherwise                         → polling off
 */

import * as vscode from 'vscode';
import type { TulcaseSettings } from '../config';
import type { TagTreeProvider } from '../providers/tag-tree.provider';
import { getPipeConfig, onPipeConfigChange } from './pipe-config';
import { GitLabClient } from './gitlab-client';
import { GitLabSecrets } from './secrets';
import { PipelineStore } from './pipeline-store';
import { PipeScopeStore } from './scope-store';
import { PipelinePoller } from './pipeline-poller';
import { LogPoller } from './log-poller';
import { LogDocumentProvider } from './log-document';
import { AnsiDecorationManager } from './ansi';
import { LogLens } from './log-lens';
import { PipeNotifier } from './notifier';
import { PipeStatusBar } from './pipe-status-bar';
import { PipePipelinesViewProvider } from '../views/pipe-pipelines.view';
import { PipeScopesViewProvider } from '../views/pipe-scopes.view';
import { registerPipeCommands } from '../commands/pipe-commands';
import type { Subscription } from './events';

export interface PipeFeatureOptions {
    /** Lets the scope store suppress file-watcher echoes of its own writes. */
    markSelfWrite?: (filePath: string) => void;
}

export class PipeFeature implements vscode.Disposable {
    readonly scopeStore: PipeScopeStore;
    readonly pipelineStore: PipelineStore;
    readonly client: GitLabClient;
    readonly secrets: GitLabSecrets;
    readonly poller: PipelinePoller;

    private readonly logPoller: LogPoller;
    private readonly logDoc: LogDocumentProvider;
    private readonly ansi: AnsiDecorationManager;
    private readonly logLens: LogLens;
    private readonly notifier: PipeNotifier;
    private readonly statusBar: PipeStatusBar;
    private readonly pipelinesView: PipePipelinesViewProvider;
    private readonly scopesView: PipeScopesViewProvider;

    private readonly _subs: Subscription[] = [];
    private readonly _disposables: vscode.Disposable[] = [];

    private _viewVisible = false;
    private _hasFollowed = false;

    constructor(
        context: vscode.ExtensionContext,
        settings: TulcaseSettings,
        tagTree: TagTreeProvider,
        options: PipeFeatureOptions = {},
    ) {
        // ── Domain plane ──────────────────────────────────────────────────
        this.secrets = new GitLabSecrets(context.secrets);
        this.client = new GitLabClient({
            baseUrl: () => getPipeConfig().url,
            getToken: () => this.secrets.getToken(),
        });
        this.scopeStore = new PipeScopeStore(settings);
        if (options.markSelfWrite) {
            this.scopeStore.markSelfWrite = options.markSelfWrite;
        }
        this.pipelineStore = new PipelineStore();
        this.poller = new PipelinePoller(
            () => getPipeConfig(), this.client, this.pipelineStore, this.scopeStore,
        );

        // ── Log plumbing ──────────────────────────────────────────────────
        this.logPoller = new LogPoller(
            this.client, () => getPipeConfig(), this.pipelineStore, this.scopeStore,
        );
        this.logDoc = new LogDocumentProvider();
        this.ansi = new AnsiDecorationManager();
        this.logLens = new LogLens(this.logDoc, this.logPoller, this.ansi);

        // ── Notifications + status bar ────────────────────────────────────
        const openedJobs = new Set<number>();
        this.notifier = new PipeNotifier(
            () => getPipeConfig(), this.pipelineStore, this.scopeStore, openedJobs,
        );
        this.statusBar = new PipeStatusBar(
            () => getPipeConfig(), this.pipelineStore, this.scopeStore,
        );

        // ── Views ─────────────────────────────────────────────────────────
        this.pipelinesView = new PipePipelinesViewProvider(
            settings, tagTree,
            this.pipelineStore, this.scopeStore, this.secrets, this.poller,
            visible => {
                this._viewVisible = visible;
                this._applyPollMode();
            },
        );
        this.scopesView = new PipeScopesViewProvider(
            settings, tagTree, this.scopeStore, this.secrets, this.client,
        );

        // ── Registration ──────────────────────────────────────────────────
        context.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider(
                LogDocumentProvider.scheme, this.logDoc,
            ),
            vscode.window.registerWebviewViewProvider(
                PipePipelinesViewProvider.viewType, this.pipelinesView,
                { webviewOptions: { retainContextWhenHidden: true } },
            ),
            vscode.window.registerWebviewViewProvider(
                PipeScopesViewProvider.viewType, this.scopesView,
                { webviewOptions: { retainContextWhenHidden: true } },
            ),
        );

        registerPipeCommands(context, {
            client: this.client,
            secrets: this.secrets,
            store: this.pipelineStore,
            scopes: this.scopeStore,
            pipelinePoller: this.poller,
            logPoller: this.logPoller,
            logLens: this.logLens,
            openedJobs,
        });

        // ── Reactions ─────────────────────────────────────────────────────
        this._subs.push(
            // Scope changes (UI edits or git sync) refresh follow state + data.
            this.scopeStore.onDidChange(() => {
                void this._refreshFollowFlag().then(() => {
                    if (this.poller.mode !== 'off') { void this.poller.tickNow(); }
                });
            }),
        );
        this._disposables.push(
            onPipeConfigChange(() => {
                this.statusBar.update();
                if (this.poller.mode !== 'off') { void this.poller.tickNow(); }
            }),
        );

        // Initial follow state (enables background polling without the view).
        void this._refreshFollowFlag();
    }

    /** Re-read scopes and push fresh data into both views (e.g. on DB switch). */
    refresh(): void {
        this.pipelinesView.refresh();
        this.scopesView.refresh();
        this.statusBar.update();
        void this._refreshFollowFlag().then(() => {
            if (this.poller.mode !== 'off') { void this.poller.tickNow(); }
        });
    }

    /** The scopes file changed on disk (git sync / external edit). */
    onScopesFileChanged(): void {
        this.refresh();
    }

    private async _refreshFollowFlag(): Promise<void> {
        const scopes = await this.scopeStore.listScopes();
        this._hasFollowed = scopes.some(s => s.enabled && s.follow);
        this._applyPollMode();
    }

    private _applyPollMode(): void {
        const mode = this._viewVisible ? 'all' : (this._hasFollowed ? 'followed' : 'off');
        this.poller.setMode(mode);
    }

    dispose(): void {
        for (const s of this._subs) { s.dispose(); }
        for (const d of this._disposables) { d.dispose(); }
        this.poller.dispose();
        this.logPoller.dispose();
        this.logLens.dispose();
        this.logDoc.dispose();
        this.ansi.dispose();
        this.notifier.dispose();
        this.statusBar.dispose();
        this.pipelinesView.dispose();
        this.scopesView.dispose();
        this.pipelineStore.dispose();
        this.scopeStore.dispose();
        this.secrets.dispose();
    }
}

import * as vscode from 'vscode';
import type { TulcaseSettings } from '../config';
import { DEFAULT_TAG_COLOR } from '../models/tag.model';
import type { TagTreeProvider } from '../providers/tag-tree.provider';
import type { PipelineStore } from '../pipe/pipeline-store';
import type { PipeScopeStore } from '../pipe/scope-store';
import type { GitLabSecrets } from '../pipe/secrets';
import type { PipelinePoller } from '../pipe/pipeline-poller';
import type { Job, Pipeline, PipeScope } from '../pipe/models';
import { ACTIVE_STATUSES, TERMINAL_STATUSES } from '../pipe/models';
import type { Subscription } from '../pipe/events';
import { BaseListViewProvider } from './base-list.view';

/**
 * Pipelines view — the main Tulcase Pipe surface in the activity bar.
 *
 * Renders followed/enabled scopes with their pipelines, stages and jobs
 * (including nested downstream pipelines), client-side filters, and all
 * pipeline / job actions.  Data flows in from the `PipelinePoller` via the
 * `PipelineStore`; the provider itself never talks to GitLab directly.
 */
export class PipePipelinesViewProvider extends BaseListViewProvider implements vscode.Disposable {
    public static readonly viewType = 'tulcase.pipePipelines';
    protected readonly viewName = 'pipe-pipelines';
    protected override readonly sidebarMode = true;

    private readonly _subs: Subscription[] = [];
    private readonly _vsDisposables: vscode.Disposable[] = [];
    private _refreshTimer: NodeJS.Timeout | undefined;

    constructor(
        settings: TulcaseSettings,
        tagTree: TagTreeProvider,
        private readonly store: PipelineStore,
        private readonly scopes: PipeScopeStore,
        private readonly secrets: GitLabSecrets,
        private readonly poller: PipelinePoller,
        /** Called with the view's visibility so the feature can pick a poll mode. */
        private readonly onVisibility: (visible: boolean) => void,
    ) {
        super(settings, tagTree);
        this._subs.push(
            // The poller writes one store update per scope per tick —
            // coalesce them into a single webview refresh.
            store.onDidChange(() => this._refreshSoon()),
            scopes.onDidChange(() => this._refreshSoon()),
            poller.onError(err => this._showBanner(err.message)),
            poller.onTickStart(() => this._clearBanner()),
        );
        this._vsDisposables.push(
            secrets.onDidChange(() => this.refresh()),
        );
    }

    /** Debounced refresh: batches the per-scope store updates of one tick. */
    private _refreshSoon(): void {
        if (this._refreshTimer) { clearTimeout(this._refreshTimer); }
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = undefined;
            this.refresh();
        }, 100);
    }

    override resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ): void {
        super.resolveWebviewView(webviewView, context, token);
        const update = () => this.onVisibility(webviewView.visible);
        update();
        webviewView.onDidChangeVisibility(update);
        webviewView.onDidDispose(() => this.onVisibility(false));
    }

    // ── Messages ───────────────────────────────────────────────────────────────

    protected async _handleMessage(msg: {
        type: string;
        jobId?: number;
        pipelineId?: number;
        scopeId?: string;
        project?: string;
        action?: string;
        newTab?: boolean;
    }): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendData();
                break;
            case 'refresh':
                await vscode.commands.executeCommand('tulcase.pipe.refresh');
                break;
            case 'setToken':
                await vscode.commands.executeCommand('tulcase.pipe.setToken');
                break;
            case 'openScopes':
                await vscode.commands.executeCommand('tulcase.pipeScopes.focus');
                break;
            case 'runPipeline':
                await vscode.commands.executeCommand('tulcase.pipe.runPipeline', msg.project);
                break;
            case 'toggleFollow':
                if (msg.scopeId) {
                    const scope = await this.scopes.getScope(msg.scopeId);
                    if (scope) { await this.scopes.setFollow(scope.id, !scope.follow); }
                }
                break;
            case 'openJob':
                if (typeof msg.jobId === 'number') {
                    await vscode.commands.executeCommand(
                        'tulcase.pipe.openJobLog', msg.jobId, { newTab: Boolean(msg.newTab) },
                    );
                }
                break;
            case 'jobAction':
                if (typeof msg.jobId === 'number' && msg.action) {
                    await this._runJobAction(msg.action, msg.jobId);
                }
                break;
            case 'pipeAction':
                if (typeof msg.pipelineId === 'number' && msg.action) {
                    await this._runPipeAction(msg.action, msg.pipelineId);
                }
                break;
        }
    }

    private async _runJobAction(action: string, jobId: number): Promise<void> {
        const commands: Record<string, string> = {
            retry:     'tulcase.pipe.retryJob',
            cancel:    'tulcase.pipe.cancelJob',
            play:      'tulcase.pipe.playJob',
            browser:   'tulcase.pipe.openJobInBrowser',
            copy:      'tulcase.pipe.copyJobUrl',
            artifacts: 'tulcase.pipe.downloadArtifacts',
        };
        const command = commands[action];
        if (command) { await vscode.commands.executeCommand(command, jobId); }
    }

    private async _runPipeAction(action: string, pipelineId: number): Promise<void> {
        const commands: Record<string, string> = {
            retry:   'tulcase.pipe.retryPipeline',
            cancel:  'tulcase.pipe.cancelPipeline',
            browser: 'tulcase.pipe.openPipelineInBrowser',
            copy:    'tulcase.pipe.copyPipelineUrl',
        };
        const command = commands[action];
        if (command) { await vscode.commands.executeCommand(command, pipelineId); }
    }

    // ── Data push ──────────────────────────────────────────────────────────────

    protected async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const [hasToken, allScopes, tagMap] = await Promise.all([
            this.secrets.getToken().then(Boolean),
            this.scopes.listScopes(),
            this.tagTree.getTagMap(),
        ]);

        const scopes = allScopes
            .filter(s => s.enabled)
            .map(s => this._serializeScope(s, tagMap));

        this._view.webview.postMessage({
            type: 'updateData',
            hasToken,
            totalScopes: allScopes.length,
            scopes,
        });
    }

    private _serializeScope(
        scope: PipeScope,
        tagMap: Record<string, { color: string }>,
    ) {
        return {
            id: scope.id,
            label: scope.label,
            follow: scope.follow,
            projects: scope.projects,
            // Preset for the per-scope "Run" button (unambiguous only).
            runProject: scope.projects.length === 1 ? scope.projects[0] : undefined,
            tags: scope.tags.map(name => ({
                name,
                color: tagMap[name]?.color ?? DEFAULT_TAG_COLOR,
            })),
            pipelines: this.store.scopeSnapshot(scope.id).map(serializePipeline),
        };
    }

    private _showBanner(text: string): void {
        const trimmed = text.length > 220 ? text.slice(0, 217) + '…' : text;
        this._view?.webview.postMessage({ type: 'banner', kind: 'error', text: trimmed });
    }

    private _clearBanner(): void {
        this._view?.webview.postMessage({ type: 'clearBanner' });
    }

    dispose(): void {
        if (this._refreshTimer) { clearTimeout(this._refreshTimer); }
        for (const s of this._subs) { s.dispose(); }
        for (const d of this._vsDisposables) { d.dispose(); }
    }
}

// ── Serialization ────────────────────────────────────────────────────────────

function serializeJob(j: Job): Record<string, unknown> {
    const obj: Record<string, unknown> = {
        id: j.id,
        name: j.name,
        stage: j.stage,
        status: j.status,
        duration: j.duration,
        hasArtifacts: j.hasArtifacts,
        allowFailure: j.allowFailure,
        isBridge: j.isBridge,
        hasDownstream: Boolean(j.downstreamPipelineId),
        canPlay: j.status === 'manual' && !j.isBridge,
        canRetry: (TERMINAL_STATUSES as readonly string[]).includes(j.status) && !j.isBridge,
        canCancel: (ACTIVE_STATUSES as readonly string[]).includes(j.status),
    };
    if (j.children && j.children.length > 0) {
        obj.children = j.children.map(serializeJob);
    }
    return obj;
}

function serializePipeline(p: Pipeline) {
    return {
        id: p.id,
        iid: p.iid,
        ref: p.ref,
        // Full SHA so pasted commit hashes match in the filter;
        // the webview truncates for display.
        sha: p.sha,
        status: p.status,
        source: p.source,
        updatedAt: p.updatedAt,
        user: p.user?.username,
        projectPath: p.projectPath,
        canRetry: p.status === 'failed' || p.status === 'canceled',
        canCancel: (ACTIVE_STATUSES as readonly string[]).includes(p.status),
        jobs: p.jobs.map(serializeJob),
    };
}

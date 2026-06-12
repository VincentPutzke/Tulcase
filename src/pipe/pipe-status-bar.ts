/**
 * Status bar item showing the latest pipeline status for the current Git
 * branch.  Disambiguates by repository **remote URL** so the displayed status
 * always matches the project the user is currently editing in.
 */

import * as vscode from 'vscode';
import type { PipelineStore } from './pipeline-store';
import type { PipeScopeStore } from './scope-store';
import type { Subscription } from './events';
import type { GitLabStatus, Pipeline } from './models';

export interface StatusBarConfigProvider {
    (): { statusBarEnabled: boolean };
}

export class PipeStatusBar implements vscode.Disposable {
    private readonly _item: vscode.StatusBarItem;
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _subs: Subscription[] = [];
    private _latestUrl: string | undefined;
    private _hasScopes = false;

    constructor(
        private readonly getConfig: StatusBarConfigProvider,
        private readonly store: PipelineStore,
        private readonly scopes: PipeScopeStore,
    ) {
        this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
        this._item.command = 'tulcase.pipe.statusBarClick';
        this._disposables.push(
            this._item,
            vscode.commands.registerCommand('tulcase.pipe.statusBarClick', () => this._onClick()),
            vscode.window.onDidChangeActiveTextEditor(() => this.update()),
        );
        this._subs.push(
            this.store.onDidChange(() => this.update()),
            this.scopes.onDidChange(() => { void this._refreshScopesFlag(); }),
        );
        this._hookGit();
        void this._refreshScopesFlag();
    }

    /** Re-read scope presence (also for external file changes / DB switches). */
    async refreshScopes(): Promise<void> {
        await this._refreshScopesFlag();
    }

    private async _refreshScopesFlag(): Promise<void> {
        this._hasScopes = (await this.scopes.listScopes()).some(s => s.enabled);
        this.update();
    }

    private _hookGit(): void {
        const ext = vscode.extensions.getExtension<{ getAPI: (v: number) => GitApi }>('vscode.git');
        if (!ext) { return; }
        const init = async () => {
            const inst = await ext.activate();
            const api  = inst.getAPI(1);
            const wire = (repo: GitRepository) => {
                this._disposables.push(repo.state.onDidChange(() => this.update()));
            };
            for (const r of api.repositories) { wire(r); }
            this._disposables.push(api.onDidOpenRepository(r => { wire(r); this.update(); }));
            this.update();
        };
        void init().catch(() => { /* git extension unavailable — silent */ });
    }

    update(): void {
        if (!this.getConfig().statusBarEnabled) { this._item.hide(); return; }
        if (!this._hasScopes) { this._item.hide(); return; }

        const ctx = currentRepoContext();
        if (!ctx?.branch) { this._item.hide(); return; }

        const match = this._findLatest(ctx);
        if (!match) {
            this._item.text = `$(git-branch) ${ctx.branch} $(question)`;
            this._item.tooltip = 'Tulcase Pipe — no matching pipeline yet';
            this._latestUrl = undefined;
            this._item.show();
            return;
        }

        this._item.text = `$(git-branch) ${ctx.branch} ${statusIcon(match.status)}`;
        this._item.tooltip = new vscode.MarkdownString(
            `**${match.projectPath}** · \`${match.ref}\` · *${match.status}*\n\nClick to open in GitLab.`,
        );
        this._latestUrl = match.webUrl;
        this._item.show();
    }

    private _findLatest(ctx: RepoContext): Pipeline | undefined {
        // Prefer pipelines from a project whose path is contained in the
        // remote URL of the active repo.  Falls back to any branch match.
        const remote = (ctx.remoteUrl ?? '').toLowerCase();
        let best: Pipeline | undefined;
        let bestScore = 0;
        for (const { pipelines } of this.store.snapshot()) {
            for (const p of pipelines) {
                if (p.ref !== ctx.branch) { continue; }
                const score = remote.includes(String(p.projectPath).toLowerCase()) ? 2 : 1;
                if (score > bestScore ||
                    (score === bestScore &&
                     (!best || Date.parse(p.updatedAt) > Date.parse(best.updatedAt)))) {
                    best = p;
                    bestScore = score;
                }
            }
        }
        return best;
    }

    private async _onClick(): Promise<void> {
        if (this._latestUrl) {
            await vscode.env.openExternal(vscode.Uri.parse(this._latestUrl));
        } else {
            await vscode.commands.executeCommand('tulcase.pipePipelines.focus');
        }
    }

    dispose(): void {
        for (const d of this._disposables) { d.dispose(); }
        for (const s of this._subs) { s.dispose(); }
    }
}

// ── Branch / remote detection via `vscode.git` ──────────────────────────────

interface GitRepository {
    state: {
        HEAD?: { name?: string };
        remotes: Array<{ fetchUrl?: string; pushUrl?: string }>;
        onDidChange: vscode.Event<void>;
    };
    rootUri: vscode.Uri;
}
interface GitApi {
    repositories: GitRepository[];
    onDidOpenRepository: vscode.Event<GitRepository>;
}

interface RepoContext { branch?: string; remoteUrl?: string }

function currentRepoContext(): RepoContext | undefined {
    const ext = vscode.extensions.getExtension<{ getAPI: (v: number) => GitApi }>('vscode.git');
    if (!ext?.isActive) { return undefined; }
    try {
        const api  = ext.exports.getAPI(1);
        const repo = api.repositories[0];
        if (!repo) { return undefined; }
        return {
            branch:    repo.state.HEAD?.name,
            remoteUrl: repo.state.remotes[0]?.fetchUrl ?? repo.state.remotes[0]?.pushUrl,
        };
    } catch {
        return undefined;
    }
}

function statusIcon(status: GitLabStatus): string {
    switch (status) {
        case 'success':  return '$(check)';
        case 'failed':   return '$(error)';
        case 'running':  return '$(sync~spin)';
        case 'pending':
        case 'created':
        case 'preparing':
        case 'waiting_for_resource':
        case 'scheduled': return '$(clock)';
        case 'manual':   return '$(play)';
        case 'canceled':
        case 'skipped':  return '$(circle-slash)';
        default:         return '$(question)';
    }
}

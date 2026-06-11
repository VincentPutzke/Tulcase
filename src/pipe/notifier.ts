/**
 * Toast notifications for the pipe feature.
 *
 * Two independent triggers:
 *
 *   1. **Opened job logs** — when a job whose log the user opened reaches a
 *      terminal status (gated by `tulcase.pipe.notifyOnFinish`).
 *   2. **Followed scopes** — when any pipeline inside a scope marked
 *      "Follow" reaches a terminal status.  This works even while the
 *      Pipelines view is hidden (background polling covers followed scopes).
 *
 * Failed → error toast, canceled/skipped → warning, success → info.
 */

import * as vscode from 'vscode';
import type { PipelineStore, JobStatusTransition, PipelineStatusTransition } from './pipeline-store';
import type { PipeScopeStore } from './scope-store';
import type { Subscription } from './events';
import { TERMINAL_STATUSES, type GitLabStatus, type Pipeline } from './models';

export interface NotifierConfigProvider {
    (): { notifyOnFinish: boolean };
}

export class PipeNotifier implements vscode.Disposable {
    private readonly _subs: Subscription[] = [];

    constructor(
        private readonly getConfig: NotifierConfigProvider,
        private readonly store: PipelineStore,
        private readonly scopes: PipeScopeStore,
        private readonly openedJobs: Set<number>,
    ) {
        this._subs.push(
            store.onJobStatusChange(t => this._onJobTransition(t)),
            store.onPipelineStatusChange(t => { void this._onPipelineTransition(t); }),
            store.onDidChange(() => this._pruneOpenedJobs()),
        );
    }

    // ── Opened-log job toasts ────────────────────────────────────────────────

    private _onJobTransition(t: JobStatusTransition): void {
        if (!this.getConfig().notifyOnFinish) { return; }
        if (!this.openedJobs.has(t.job.id)) { return; }
        if (!isFinish(t.oldStatus, t.newStatus)) { return; }

        const job = t.job;
        const message = `${job.projectPath} · ${job.name}: ${t.newStatus}`;
        const showFn = pickToast(t.newStatus);

        void showFn(message, 'Open Log', 'Open in GitLab').then(choice => {
            if (choice === 'Open Log') {
                void vscode.commands.executeCommand('tulcase.pipe.openJobLog', job.id);
            } else if (choice === 'Open in GitLab') {
                void vscode.commands.executeCommand('tulcase.pipe.openJobInBrowser', job.id);
            }
        });
    }

    // ── Followed-scope pipeline toasts ───────────────────────────────────────

    private async _onPipelineTransition(t: PipelineStatusTransition): Promise<void> {
        if (!isFinish(t.oldStatus, t.newStatus)) { return; }

        const followed = (await this.scopes.listScopes()).filter(s => s.enabled && s.follow);
        if (followed.length === 0) { return; }

        // The transition fires while the new snapshot is being written, so
        // membership is checked against the store (covers overlapping scopes
        // without double-toasting: one toast per pipeline transition).
        const inFollowed = followed.find(s => this.store.scopeHasPipeline(s.id, t.pipeline.id));
        if (!inFollowed) { return; }

        const p = t.pipeline;
        const message =
            `${inFollowed.label}: pipeline ${verb(t.newStatus)} — ${p.projectPath} · ${p.ref}`;
        const showFn = pickToast(t.newStatus);

        void showFn(message, 'Open in GitLab', 'Show Pipelines').then(choice => {
            if (choice === 'Open in GitLab') {
                void vscode.env.openExternal(vscode.Uri.parse(p.webUrl));
            } else if (choice === 'Show Pipelines') {
                void vscode.commands.executeCommand('tulcase.pipePipelines.focus');
            }
        });
    }

    private _pruneOpenedJobs(): void {
        if (this.openedJobs.size === 0) { return; }
        for (const id of Array.from(this.openedJobs)) {
            if (!this.store.findJob(id)) { this.openedJobs.delete(id); }
        }
    }

    dispose(): void {
        for (const s of this._subs) { s.dispose(); }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Non-terminal → terminal transition with a known previous state. */
function isFinish(oldStatus: GitLabStatus | undefined, newStatus: GitLabStatus): boolean {
    if (oldStatus === undefined) { return false; }
    if (!TERMINAL_STATUSES.includes(newStatus)) { return false; }
    return !TERMINAL_STATUSES.includes(oldStatus);
}

function pickToast(status: GitLabStatus): typeof vscode.window.showInformationMessage {
    if (status === 'failed') { return vscode.window.showErrorMessage; }
    if (status === 'canceled' || status === 'skipped') { return vscode.window.showWarningMessage; }
    return vscode.window.showInformationMessage;
}

function verb(status: GitLabStatus): string {
    switch (status) {
        case 'success':  return 'passed';
        case 'failed':   return 'failed';
        case 'canceled': return 'was canceled';
        case 'skipped':  return 'was skipped';
        default:         return status;
    }
}

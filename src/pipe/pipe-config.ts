/**
 * Reader for the `tulcase.pipe.*` VS Code settings.
 *
 * Pollers call `getPipeConfig()` at the start of every tick so settings
 * changes apply without restarts.  Scopes are NOT part of this config —
 * they live in the Tulcase database (see `scope-store.ts`).
 */

import * as vscode from 'vscode';

export interface PipeConfig {
    /** GitLab base URL without `/api/v4`. */
    url: string;
    /** Seconds between pipeline-list refreshes (min 5). */
    pollIntervalSeconds: number;
    /** Seconds between log refreshes for an open running job (min 1). */
    logPollIntervalSeconds: number;
    /** Max concurrent HTTP requests per poll cycle (1–16). */
    maxConcurrentRequests: number;
    /** Toast when a job whose log is open finishes. */
    notifyOnFinish: boolean;
    /** Show the current branch's pipeline status in the status bar. */
    statusBarEnabled: boolean;
}

export function getPipeConfig(): PipeConfig {
    const cfg = vscode.workspace.getConfiguration('tulcase.pipe');

    const rawUrl = (cfg.get<string>('url') ?? 'https://gitlab.com').trim();
    const url = (rawUrl || 'https://gitlab.com')
        .replace(/\/+$/, '')
        .replace(/\/api\/v4$/, '');

    const poll    = cfg.get<number>('pollIntervalSeconds') ?? 30;
    const logPoll = cfg.get<number>('logPollIntervalSeconds') ?? 2;
    const conc    = cfg.get<number>('maxConcurrentRequests') ?? 4;

    return {
        url,
        pollIntervalSeconds:    Math.max(5, Number.isFinite(poll) ? poll : 30),
        logPollIntervalSeconds: Math.max(1, Number.isFinite(logPoll) ? logPoll : 2),
        maxConcurrentRequests:  Math.min(16, Math.max(1, Number.isFinite(conc) ? conc : 4)),
        notifyOnFinish:  cfg.get<boolean>('notifyOnFinish') ?? true,
        statusBarEnabled: cfg.get<boolean>('statusBar.enabled') ?? true,
    };
}

/** Fires when any `tulcase.pipe.*` setting changes. */
export function onPipeConfigChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('tulcase.pipe')) {
            listener();
        }
    });
}

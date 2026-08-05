/**
 * Reader for the GitLab settings (`tulcase.gitlab.*`).
 *
 * Pollers call the getters at the start of every tick so settings changes
 * apply without restarts.  Scopes are NOT part of this config — they live in
 * the Tulcase database (see `scope-store.ts`).
 *
 * Migration (ADR-0002): keys moved from the old `tulcase.pipe.*` namespace to
 * the `tulcase.gitlab.*` umbrella. The old keys are kept as **deprecated
 * aliases** — every value is resolved new-key-first, falling back to the old
 * key, so existing `settings.json` files keep working.
 */

import * as vscode from 'vscode';

export interface PipeConfig {
    /** GitLab base URL without `/api/v4`. */
    url: string;
    /** Seconds between pipeline-list refreshes (min 5). */
    pollIntervalSeconds: number;
    /** Seconds between log refreshes for an open running job (min 1). */
    logPollIntervalSeconds: number;
    /** Max concurrent HTTP requests (global ceiling, 1–16). */
    maxConcurrentRequests: number;
    /** Toast when a job whose log is open finishes. */
    notifyOnFinish: boolean;
    /** Show the current branch's pipeline status in the status bar. */
    statusBarEnabled: boolean;
    /** Cap on projects a single group source expands into for Pipe polling. */
    maxExpandedProjects: number;
}

export interface RegistryConfig {
    /** GitLab base URL without `/api/v4` (shared with Pipe). */
    url: string;
    /** Seconds between refreshes of expanded registry nodes (min 10). */
    pollIntervalSeconds: number;
    /** Max concurrent HTTP requests (global ceiling, shared with Pipe). */
    maxConcurrentRequests: number;
}

// ── Alias-aware resolution ────────────────────────────────────────────────────

/** The explicit (user-set) value of a fully-qualified setting id, if any. */
function explicit<T>(fullId: string): T | undefined {
    const ins = vscode.workspace.getConfiguration().inspect<T>(fullId);
    if (!ins) { return undefined; }
    return ins.workspaceFolderValue ?? ins.workspaceValue ?? ins.globalValue ?? undefined;
}

/** New key first, then the deprecated alias, then the new key's default. */
function resolve<T>(newId: string, oldId: string, fallback: T): T {
    const fromNew = explicit<T>(newId);
    if (fromNew !== undefined) { return fromNew; }
    const fromOld = explicit<T>(oldId);
    if (fromOld !== undefined) { return fromOld; }
    const def = vscode.workspace.getConfiguration().get<T>(newId);
    return def !== undefined ? def : fallback;
}

function normalizeUrl(raw: string): string {
    const trimmed = (raw ?? 'https://gitlab.com').trim();
    return (trimmed || 'https://gitlab.com')
        .replace(/\/+$/, '')
        .replace(/\/api\/v4$/, '');
}

function resolvedUrl(): string {
    return normalizeUrl(resolve<string>('tulcase.gitlab.url', 'tulcase.pipe.url', 'https://gitlab.com'));
}

function resolvedConcurrency(): number {
    const conc = resolve<number>(
        'tulcase.gitlab.maxConcurrentRequests', 'tulcase.pipe.maxConcurrentRequests', 4,
    );
    return Math.min(16, Math.max(1, Number.isFinite(conc) ? conc : 4));
}

// ── Public getters ────────────────────────────────────────────────────────────

export function getPipeConfig(): PipeConfig {
    const poll = resolve<number>(
        'tulcase.gitlab.pipe.pollIntervalSeconds', 'tulcase.pipe.pollIntervalSeconds', 30);
    const logPoll = resolve<number>(
        'tulcase.gitlab.pipe.logPollIntervalSeconds', 'tulcase.pipe.logPollIntervalSeconds', 2);
    const maxExpanded = resolve<number>(
        'tulcase.gitlab.pipe.maxExpandedProjects', 'tulcase.gitlab.pipe.maxExpandedProjects', 100);

    return {
        url: resolvedUrl(),
        pollIntervalSeconds:    Math.max(5, Number.isFinite(poll) ? poll : 30),
        logPollIntervalSeconds: Math.max(1, Number.isFinite(logPoll) ? logPoll : 2),
        maxConcurrentRequests:  resolvedConcurrency(),
        notifyOnFinish: resolve<boolean>(
            'tulcase.gitlab.pipe.notifyOnFinish', 'tulcase.pipe.notifyOnFinish', true),
        statusBarEnabled: resolve<boolean>(
            'tulcase.gitlab.pipe.statusBar.enabled', 'tulcase.pipe.statusBar.enabled', true),
        maxExpandedProjects: Math.max(1, Number.isFinite(maxExpanded) ? Math.floor(maxExpanded) : 100),
    };
}

export function getRegistryConfig(): RegistryConfig {
    const poll = resolve<number>(
        'tulcase.gitlab.registry.pollIntervalSeconds',
        'tulcase.gitlab.registry.pollIntervalSeconds', 60);
    return {
        url: resolvedUrl(),
        pollIntervalSeconds:   Math.max(10, Number.isFinite(poll) ? poll : 60),
        maxConcurrentRequests: resolvedConcurrency(),
    };
}

/** Fires when any GitLab-related setting changes (new umbrella or old alias). */
export function onPipeConfigChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('tulcase.gitlab') || e.affectsConfiguration('tulcase.pipe')) {
            listener();
        }
    });
}

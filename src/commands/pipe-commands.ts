/**
 * Command handlers for the Tulcase Pipe feature.
 *
 * Everything action-shaped lives here: token management, refresh, opening
 * job logs (switch / pinned tab), browser + clipboard helpers, artifact and
 * log downloads, and the pipeline write actions (run with variables+inputs,
 * retry, cancel, play manual jobs).
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import type { GitLabClient, PipelineVariable } from '../pipe/gitlab-client';
import { describeApiError } from '../pipe/gitlab-client';
import type { GitLabSecrets } from '../pipe/secrets';
import type { PipelineStore } from '../pipe/pipeline-store';
import type { PipeScopeStore } from '../pipe/scope-store';
import type { LogPoller } from '../pipe/log-poller';
import { stripAnsi } from '../pipe/log-poller';
import type { PipelinePoller } from '../pipe/pipeline-poller';
import type { LogLens } from '../pipe/log-lens';
import { LogDocumentProvider } from '../pipe/log-document';
import type { Job, Pipeline } from '../pipe/models';

export interface PipeCommandDeps {
    client:         GitLabClient;
    secrets:        GitLabSecrets;
    store:          PipelineStore;
    scopes:         PipeScopeStore;
    pipelinePoller: PipelinePoller;
    logPoller:      LogPoller;
    logLens:        LogLens;
    /** Job IDs the user opened this session (gates notifications). */
    openedJobs:     Set<number>;
}

export function registerPipeCommands(
    context: vscode.ExtensionContext,
    deps: PipeCommandDeps,
): void {
    const reg = (id: string, handler: (...a: never[]) => unknown) =>
        context.subscriptions.push(
            vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown),
        );

    // ── Token & refresh ──────────────────────────────────────────────────────

    reg('tulcase.pipe.setToken', async () => {
        const token = await deps.secrets.promptAndStore();
        if (!token) { return; }
        try {
            const me = await deps.client.validateToken();
            vscode.window.showInformationMessage(
                `Tulcase Pipe: token saved (authenticated as @${me.username}).`,
            );
        } catch (err) {
            vscode.window.showWarningMessage(
                `Tulcase Pipe: token saved, but verification failed — ${describeApiError(err)}`,
            );
        }
        await deps.pipelinePoller.tickNow();
    });

    reg('tulcase.pipe.clearToken', async () => {
        await deps.secrets.clearToken();
        vscode.window.showInformationMessage('Tulcase Pipe: token cleared.');
    });

    reg('tulcase.pipe.refresh', async () => {
        await deps.pipelinePoller.tickNow();
    });

    // ── Job log ──────────────────────────────────────────────────────────────

    reg('tulcase.pipe.openJobLog', async (jobId?: number, opts?: { newTab?: boolean }) => {
        const job = resolveJob(deps.store, jobId);
        if (!job) { return; }
        deps.openedJobs.add(job.id);
        await deps.logLens.open(job, { newTab: Boolean(opts?.newTab) });
    });

    reg('tulcase.pipe.saveJobLog', async (jobId?: number) => {
        if (jobId === undefined) {
            vscode.window.showWarningMessage('Tulcase Pipe: no job selected.');
            return;
        }
        await saveLogForJob(deps, jobId);
    });

    // Save the log of the currently focused log editor (editor title button).
    reg('tulcase.pipe.saveOpenLog', async () => {
        const uri = vscode.window.activeTextEditor?.document.uri;
        if (!uri || uri.scheme !== LogDocumentProvider.scheme) {
            vscode.window.showInformationMessage('Focus a Tulcase Pipe job log first.');
            return;
        }
        // Path shape: /<projectId>/<jobId>/<name>.log
        const jobId = Number(uri.path.split('/')[2]);
        if (!Number.isFinite(jobId)) { return; }
        await saveLogForJob(deps, jobId);
    });

    // ── Scopes file helpers ──────────────────────────────────────────────────

    reg('tulcase.pipe.editScopesJson', async () => {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(deps.scopes.filePath));
        await vscode.window.showTextDocument(doc, { preview: false });
    });

    reg('tulcase.pipe.importScopes', async () => {
        const picked = await vscode.window.showOpenDialog({
            title: 'Import Tulcase Pipe scopes (scopes.jsonc)',
            canSelectMany: false,
            filters: { 'Scopes file': ['jsonc', 'json'] },
        });
        if (!picked || picked.length === 0) { return; }
        try {
            const text = await fs.promises.readFile(picked[0].fsPath, 'utf-8');
            const parsed: unknown = parseJsonc(text);
            const result = await deps.scopes.importLegacy(parsed);
            if (result.scopes === 0 && result.rules === 0) {
                vscode.window.showInformationMessage(
                    'Tulcase Pipe: nothing new to import (scopes already exist or the file is empty).',
                );
            } else {
                vscode.window.showInformationMessage(
                    `Tulcase Pipe: imported ${result.scopes} scope(s) and ${result.rules} log rule(s).`,
                );
            }
        } catch (err) {
            vscode.window.showErrorMessage(
                `Tulcase Pipe: import failed — ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    });

    // ── Browser / clipboard ──────────────────────────────────────────────────

    reg('tulcase.pipe.openJobInBrowser', async (jobId?: number) => {
        const job = resolveJob(deps.store, jobId);
        if (job) { await vscode.env.openExternal(vscode.Uri.parse(job.webUrl)); }
    });

    reg('tulcase.pipe.openPipelineInBrowser', async (pipelineId?: number) => {
        const p = resolvePipeline(deps.store, pipelineId);
        if (p) { await vscode.env.openExternal(vscode.Uri.parse(p.webUrl)); }
    });

    reg('tulcase.pipe.copyJobUrl', async (jobId?: number) => {
        const job = resolveJob(deps.store, jobId);
        if (job) {
            await vscode.env.clipboard.writeText(job.webUrl);
            vscode.window.showInformationMessage(`Copied: ${job.webUrl}`);
        }
    });

    reg('tulcase.pipe.copyPipelineUrl', async (pipelineId?: number) => {
        const p = resolvePipeline(deps.store, pipelineId);
        if (p) {
            await vscode.env.clipboard.writeText(p.webUrl);
            vscode.window.showInformationMessage(`Copied: ${p.webUrl}`);
        }
    });

    // ── Artifacts ────────────────────────────────────────────────────────────

    reg('tulcase.pipe.downloadArtifacts', async (jobId?: number) => {
        const job = resolveJob(deps.store, jobId);
        if (!job) { return; }
        if (!job.hasArtifacts) {
            vscode.window.showInformationMessage(`No artifacts available for job "${job.name}".`);
            return;
        }
        const target = await vscode.window.showSaveDialog({
            title: 'Save artifacts',
            defaultUri: vscode.Uri.file(`artifacts-${job.name}-${job.id}.zip`),
            filters: { 'ZIP Archive': ['zip'] },
        });
        if (!target) { return; }
        try {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Downloading artifacts of "${job.name}"…` },
                async () => {
                    const buf = await deps.client.downloadArtifacts(job.projectId, job.id);
                    await fs.promises.mkdir(path.dirname(target.fsPath), { recursive: true });
                    await fs.promises.writeFile(target.fsPath, Buffer.from(buf));
                },
            );
            vscode.window.showInformationMessage(`Artifacts saved to ${target.fsPath}`);
        } catch (err) {
            vscode.window.showErrorMessage(
                `Tulcase Pipe: artifact download failed — ${describeApiError(err)}`,
            );
        }
    });

    // ── Pipeline actions ─────────────────────────────────────────────────────

    reg('tulcase.pipe.runPipeline', async (projectRef?: string) => {
        await runPipelineFlow(deps, projectRef);
    });

    reg('tulcase.pipe.retryPipeline', async (pipelineId?: number) => {
        const p = resolvePipeline(deps.store, pipelineId);
        if (!p) { return; }
        await runAction(deps, `Retrying pipeline #${p.iid ?? p.id}…`, async () => {
            await deps.client.retryPipeline(p.projectId, p.id);
        }, `Pipeline #${p.iid ?? p.id} retried (${p.projectPath} · ${p.ref}).`);
    });

    reg('tulcase.pipe.cancelPipeline', async (pipelineId?: number) => {
        const p = resolvePipeline(deps.store, pipelineId);
        if (!p) { return; }
        await runAction(deps, `Canceling pipeline #${p.iid ?? p.id}…`, async () => {
            await deps.client.cancelPipeline(p.projectId, p.id);
        }, `Pipeline #${p.iid ?? p.id} canceled (${p.projectPath} · ${p.ref}).`);
    });

    reg('tulcase.pipe.retryJob', async (jobId?: number) => {
        const job = resolveJob(deps.store, jobId);
        if (!job) { return; }
        await runAction(deps, `Retrying job "${job.name}"…`, async () => {
            await deps.client.retryJob(job.projectId, job.id);
        }, `Job "${job.name}" retried.`);
    });

    reg('tulcase.pipe.cancelJob', async (jobId?: number) => {
        const job = resolveJob(deps.store, jobId);
        if (!job) { return; }
        await runAction(deps, `Canceling job "${job.name}"…`, async () => {
            await deps.client.cancelJob(job.projectId, job.id);
        }, `Job "${job.name}" canceled.`);
    });

    reg('tulcase.pipe.playJob', async (jobId?: number) => {
        const job = resolveJob(deps.store, jobId);
        if (!job) { return; }
        await runAction(deps, `Starting manual job "${job.name}"…`, async () => {
            await deps.client.playJob(job.projectId, job.id);
        }, `Manual job "${job.name}" started.`);
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Save a job's streamed log to disk (works from the store or a live session). */
async function saveLogForJob(deps: PipeCommandDeps, jobId: number): Promise<void> {
    const session = deps.logPoller.getSession(jobId);
    const job = session?.job ?? deps.store.findJob(jobId);
    const raw = session?.snapshot() ?? '';
    if (!job || !raw) {
        vscode.window.showInformationMessage('Open the job log first, then save it.');
        return;
    }
    const target = await vscode.window.showSaveDialog({
        title: 'Save job log',
        defaultUri: vscode.Uri.file(`${job.name}-${job.id}.log`),
        filters: { 'Log File': ['log', 'txt'] },
    });
    if (!target) { return; }
    const clean = stripAnsi(raw);
    await fs.promises.mkdir(path.dirname(target.fsPath), { recursive: true });
    await fs.promises.writeFile(target.fsPath, clean, 'utf-8');
    vscode.window.showInformationMessage(`Log saved to ${target.fsPath}`);
}

function resolveJob(store: PipelineStore, jobId?: number): Job | undefined {
    if (jobId === undefined) {
        vscode.window.showWarningMessage('Tulcase Pipe: no job selected.');
        return undefined;
    }
    const job = store.findJob(jobId);
    if (!job) {
        vscode.window.showWarningMessage(`Tulcase Pipe: job ${jobId} is not in the current view.`);
        return undefined;
    }
    return job;
}

function resolvePipeline(store: PipelineStore, pipelineId?: number): Pipeline | undefined {
    if (pipelineId === undefined) {
        vscode.window.showWarningMessage('Tulcase Pipe: no pipeline selected.');
        return undefined;
    }
    const p = store.findPipeline(pipelineId);
    if (!p) {
        vscode.window.showWarningMessage(`Tulcase Pipe: pipeline ${pipelineId} is not in the current view.`);
        return undefined;
    }
    return p;
}

/** Run a write action with progress, success toast, and an instant re-poll. */
async function runAction(
    deps: PipeCommandDeps,
    progressTitle: string,
    action: () => Promise<void>,
    successMessage: string,
): Promise<void> {
    try {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: progressTitle },
            action,
        );
        vscode.window.showInformationMessage(`Tulcase Pipe: ${successMessage}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Tulcase Pipe: action failed — ${describeApiError(err)}`);
    }
    await deps.pipelinePoller.tickNow();
}

// ── Run-pipeline flow ────────────────────────────────────────────────────────

interface RunEntry {
    kind: 'variable' | 'file-variable' | 'input';
    key: string;
    value: string;
}

/**
 * Guided "Run Pipeline" flow:
 *   1. pick a project (scope projects + GitLab search),
 *   2. pick a branch (live from the API) or type any ref,
 *   3. optionally add CI/CD variables, file variables, and `spec:inputs`,
 *   4. trigger and offer to open the new pipeline.
 */
async function runPipelineFlow(deps: PipeCommandDeps, presetProject?: string): Promise<void> {
    if (!(await deps.secrets.getToken())) {
        const pick = await vscode.window.showWarningMessage(
            'Running a pipeline requires a GitLab token with `api` scope.',
            'Set Token',
        );
        if (pick === 'Set Token') {
            await vscode.commands.executeCommand('tulcase.pipe.setToken');
        }
        return;
    }

    // 1. Project ─────────────────────────────────────────────────────────────
    let project = presetProject;
    if (!project) {
        const scopes = await deps.scopes.listScopes();
        const known = [...new Set(scopes.filter(s => s.enabled).flatMap(s => s.projects))];
        const items: vscode.QuickPickItem[] = known.map(p => ({ label: p, iconPath: new vscode.ThemeIcon('repo') }));
        items.push({ label: 'Search GitLab…', iconPath: new vscode.ThemeIcon('search'), alwaysShow: true });

        const picked = await vscode.window.showQuickPick(items, {
            title: 'Run Pipeline — choose project',
            placeHolder: known.length ? 'Project from your scopes, or search GitLab' : 'Search GitLab for a project',
            ignoreFocusOut: true,
        });
        if (!picked) { return; }
        project = picked.label === 'Search GitLab…'
            ? await searchProjectFlow(deps)
            : picked.label;
        if (!project) { return; }
    }

    // 2. Ref ─────────────────────────────────────────────────────────────────
    const ref = await pickRef(deps, project);
    if (!ref) { return; }

    // 3. Variables & inputs ──────────────────────────────────────────────────
    const entries: RunEntry[] = [];
     
    while (true) {
        const menu: vscode.QuickPickItem[] = [
            { label: '$(play) Run now', description: `${project} · ${ref}`, alwaysShow: true },
            { label: '$(add) Add variable', description: 'CI/CD variable (env_var)', alwaysShow: true },
            { label: '$(file-add) Add file variable', description: 'CI/CD variable (file)', alwaysShow: true },
            { label: '$(symbol-parameter) Add input', description: 'spec:inputs value (GitLab 17.7+)', alwaysShow: true },
        ];
        if (entries.length > 0) {
            menu.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
            for (const e of entries) {
                menu.push({
                    label: `$(close) ${e.key}`,
                    description: `${e.kind} = ${e.value.length > 40 ? e.value.slice(0, 37) + '…' : e.value}`,
                    detail: 'Select to remove',
                });
            }
        }
        const choice = await vscode.window.showQuickPick(menu, {
            title: `Run Pipeline — ${project} · ${ref}`,
            placeHolder: 'Add variables / inputs, then "Run now"',
            ignoreFocusOut: true,
        });
        if (!choice) { return; }

        if (choice.label === '$(play) Run now') { break; }

        if (choice.label.startsWith('$(close) ')) {
            const key = choice.label.slice('$(close) '.length);
            const idx = entries.findIndex(e => e.key === key);
            if (idx >= 0) { entries.splice(idx, 1); }
            continue;
        }

        const kind: RunEntry['kind'] =
            choice.label === '$(add) Add variable' ? 'variable'
            : choice.label === '$(file-add) Add file variable' ? 'file-variable'
            : 'input';

        const key = await vscode.window.showInputBox({
            title: kind === 'input' ? 'Input name' : 'Variable key',
            placeHolder: kind === 'input' ? 'e.g. environment' : 'e.g. DEPLOY_ENV',
            ignoreFocusOut: true,
            validateInput: v => v.trim() ? undefined : 'Key is required.',
        });
        if (key === undefined) { continue; }
        const value = await vscode.window.showInputBox({
            title: `Value for ${key.trim()}`,
            ignoreFocusOut: true,
        });
        if (value === undefined) { continue; }

        const trimmedKey = key.trim();
        const existing = entries.findIndex(e => e.key === trimmedKey && e.kind === kind);
        if (existing >= 0) { entries.splice(existing, 1); }
        entries.push({ kind, key: trimmedKey, value });
    }

    const variables: PipelineVariable[] = entries
        .filter(e => e.kind !== 'input')
        .map(e => ({
            key: e.key,
            value: e.value,
            variableType: e.kind === 'file-variable' ? 'file' as const : 'env_var' as const,
        }));
    const inputs: Record<string, string> = {};
    for (const e of entries.filter(e => e.kind === 'input')) {
        inputs[e.key] = e.value;
    }

    // 4. Trigger ─────────────────────────────────────────────────────────────
    try {
        const pipeline = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Triggering pipeline on ${project} · ${ref}…` },
            () => deps.client.createPipeline(project!, ref, variables, inputs),
        );
        void vscode.window.showInformationMessage(
            `Pipeline #${pipeline.iid ?? pipeline.id} started on ${project} · ${ref}.`,
            'Open in GitLab',
        ).then(pick => {
            if (pick === 'Open in GitLab') {
                void vscode.env.openExternal(vscode.Uri.parse(pipeline.webUrl));
            }
        });
        await deps.pipelinePoller.tickNow();
    } catch (err) {
        vscode.window.showErrorMessage(
            `Tulcase Pipe: could not trigger pipeline — ${describeApiError(err)}`,
        );
    }
}

/** Search GitLab for a project and return its path-with-namespace. */
async function searchProjectFlow(deps: PipeCommandDeps): Promise<string | undefined> {
    const query = await vscode.window.showInputBox({
        title: 'Search GitLab projects',
        placeHolder: 'Part of the project name or path…',
        ignoreFocusOut: true,
    });
    if (!query?.trim()) { return undefined; }

    try {
        const hits = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Searching projects for "${query.trim()}"…` },
            () => deps.client.searchProjects(query.trim()),
        );
        if (hits.length === 0) {
            vscode.window.showInformationMessage(`No projects found for "${query.trim()}".`);
            return undefined;
        }
        const picked = await vscode.window.showQuickPick(
            hits.map(h => ({ label: h.pathWithNamespace, description: h.description })),
            { title: 'Choose project', ignoreFocusOut: true },
        );
        return picked?.label;
    } catch (err) {
        vscode.window.showErrorMessage(`Tulcase Pipe: project search failed — ${describeApiError(err)}`);
        return undefined;
    }
}

/** Pick a branch from the API, or fall back to typing any ref. */
async function pickRef(deps: PipeCommandDeps, project: string): Promise<string | undefined> {
    let branches: Awaited<ReturnType<GitLabClient['listBranches']>> = [];
    try {
        branches = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Loading branches of ${project}…` },
            () => deps.client.listBranches(project),
        );
    } catch {
        // Branch listing is best-effort — fall through to manual input.
    }

    const items: vscode.QuickPickItem[] = branches.map(b => ({
        label: b.name,
        description: b.default ? 'default' : undefined,
        iconPath: new vscode.ThemeIcon('git-branch'),
    }));
    items.push({ label: 'Type a ref…', iconPath: new vscode.ThemeIcon('edit'), alwaysShow: true });

    const picked = await vscode.window.showQuickPick(items, {
        title: `Run Pipeline — choose ref (${project})`,
        placeHolder: 'Branch or tag to run on',
        ignoreFocusOut: true,
    });
    if (!picked) { return undefined; }
    if (picked.label !== 'Type a ref…') { return picked.label; }

    const manual = await vscode.window.showInputBox({
        title: 'Ref (branch or tag)',
        placeHolder: 'e.g. main, v2.1.0, feature/xyz',
        ignoreFocusOut: true,
        validateInput: v => v.trim() ? undefined : 'Ref is required.',
    });
    return manual?.trim() || undefined;
}

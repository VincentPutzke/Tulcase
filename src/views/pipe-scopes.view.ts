import * as vscode from 'vscode';
import type { TulcaseSettings } from '../config';
import type { TagTreeProvider } from '../providers/tag-tree.provider';
import type { PipeScopeStore } from '../pipe/scope-store';
import type { GitLabSecrets } from '../pipe/secrets';
import type { GitLabClient } from '../pipe/gitlab-client';
import { pickProjectViaSearch } from '../pipe/pickers';
import { BUILTIN_LOG_RULES, validateRule, type LogRuleDefinition } from '../pipe/log-rules';
import { ALL_STATUSES } from '../pipe/models';
import { pickTags } from '../data/tag-picker';
import type { Subscription } from '../pipe/events';
import { BaseListViewProvider } from './base-list.view';

/**
 * Pipe Scopes view — visual management of pipeline scopes and log rules.
 *
 * Scopes are edited entirely through forms (no JSON required): project
 * picker backed by GitLab search, status chips, tag picker, follow/enable
 * toggles, and a log-rule editor with live regex preview.  "Edit as JSON"
 * stays available as an escape hatch (schema-validated).
 */
export class PipeScopesViewProvider extends BaseListViewProvider implements vscode.Disposable {
    public static readonly viewType = 'tulcase.pipeScopes';
    protected readonly viewName = 'pipe-scopes';
    protected override readonly sidebarMode = true;

    private readonly _subs: Subscription[] = [];
    private readonly _vsDisposables: vscode.Disposable[] = [];

    constructor(
        settings: TulcaseSettings,
        tagTree: TagTreeProvider,
        private readonly scopes: PipeScopeStore,
        private readonly secrets: GitLabSecrets,
        private readonly client: GitLabClient,
    ) {
        super(settings, tagTree);
        this._subs.push(
            scopes.onDidChange(() => this.refresh()),
        );
        this._vsDisposables.push(
            secrets.onDidChange(() => this.refresh()),
        );
    }

    // ── Messages ───────────────────────────────────────────────────────────────

    protected async _handleMessage(msg: {
        type: string;
        id?: string;
        scope?: unknown;
        rule?: Partial<LogRuleDefinition>;
        name?: string;
        direction?: string;
        value?: boolean;
        current?: string[];
    }): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendData();
                break;

            // ── Scope CRUD ────────────────────────────────────────────────
            case 'saveScope':
                await this._saveScope(msg.scope);
                break;
            case 'deleteScope':
                if (msg.id) { await this._deleteScope(msg.id); }
                break;
            case 'duplicateScope':
                if (msg.id) { await this.scopes.duplicateScope(msg.id); }
                break;
            case 'moveScope':
                if (msg.id && (msg.direction === 'up' || msg.direction === 'down')) {
                    await this.scopes.moveScope(msg.id, msg.direction);
                }
                break;
            case 'setEnabled':
                if (msg.id !== undefined) {
                    await this.scopes.setEnabled(msg.id, Boolean(msg.value));
                }
                break;
            case 'setFollow':
                if (msg.id !== undefined) {
                    await this.scopes.setFollow(msg.id, Boolean(msg.value));
                }
                break;

            // ── Rule CRUD ─────────────────────────────────────────────────
            case 'saveRule':
                await this._saveRule(msg.rule);
                break;
            case 'deleteRule':
                if (msg.name) { await this._deleteRule(msg.name); }
                break;

            // ── Pickers (roundtrips into native QuickPicks) ───────────────
            case 'pickProject':
                await this._pickProject();
                break;
            case 'pickTagsForForm':
                await this._pickTagsForForm(msg.current ?? []);
                break;

            // ── Misc ──────────────────────────────────────────────────────
            case 'setToken':
                await vscode.commands.executeCommand('tulcase.pipe.setToken');
                break;
            case 'editJson':
                await vscode.commands.executeCommand('tulcase.pipe.editScopesJson');
                break;
            case 'importLegacy':
                await vscode.commands.executeCommand('tulcase.pipe.importScopes');
                break;
            case 'openPipelines':
                await vscode.commands.executeCommand('tulcase.pipePipelines.focus');
                break;
        }
    }

    // ── Data push ──────────────────────────────────────────────────────────────

    protected async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const [data, hasToken, tagMap] = await Promise.all([
            this.scopes.read(),
            this.secrets.getToken().then(Boolean),
            this.tagTree.getTagMap(),
        ]);

        this._view.webview.postMessage({
            type: 'updateData',
            hasToken,
            scopes: data.scopes,
            customRules: data.logRules,
            builtinRules: BUILTIN_LOG_RULES,
            statuses: ALL_STATUSES,
            tagMap,
        });
    }

    // ── Scope operations ───────────────────────────────────────────────────────

    private async _saveScope(raw: unknown): Promise<void> {
        try {
            // upsertScope is the single normalization/validation point.
            const saved = await this.scopes.upsertScope(raw);
            this._toast(`Scope "${saved.label}" saved.`);
        } catch (err) {
            this._toast(err instanceof Error ? err.message : String(err), 'error');
        }
    }

    private async _deleteScope(id: string): Promise<void> {
        const scope = await this.scopes.getScope(id);
        if (!scope) { return; }
        const confirm = await vscode.window.showWarningMessage(
            `Delete scope "${scope.label}"?`, { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }
        await this.scopes.removeScope(id);
    }

    // ── Rule operations ────────────────────────────────────────────────────────

    private async _saveRule(rule: Partial<LogRuleDefinition> | undefined): Promise<void> {
        if (!rule) { return; }
        const error = validateRule(rule);
        if (error) {
            this._toast(error, 'error');
            return;
        }
        await this.scopes.upsertRule(rule as LogRuleDefinition);
        this._toast(`Log rule "${rule.name}" saved.`);
    }

    private async _deleteRule(name: string): Promise<void> {
        const scopes = await this.scopes.listScopes();
        const used = scopes.filter(s => s.logRules?.includes(name)).length;
        const detail = used > 0
            ? ` It is used by ${used} scope${used === 1 ? '' : 's'} and will be detached.`
            : '';
        const confirm = await vscode.window.showWarningMessage(
            `Delete log rule "${name}"?${detail}`, { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }
        await this.scopes.removeRule(name);
    }

    // ── Pickers ────────────────────────────────────────────────────────────────

    /** GitLab project search → QuickPick → send the chosen path to the form. */
    private async _pickProject(): Promise<void> {
        if (!(await this.secrets.ensureToken('Project search'))) { return; }
        const path = await pickProjectViaSearch(this.client);
        if (path) {
            this._view?.webview.postMessage({ type: 'projectPicked', path });
        }
    }

    /** Tulcase tag picker → send the selection back to the form. */
    private async _pickTagsForForm(current: string[]): Promise<void> {
        const picked = await pickTags(this.tagTree, current);
        if (picked === undefined) { return; }
        this._view?.webview.postMessage({ type: 'tagsPicked', tags: picked });
    }

    private _toast(text: string, kind: 'info' | 'error' = 'info'): void {
        this._view?.webview.postMessage({ type: 'toast', kind, text });
    }

    dispose(): void {
        for (const s of this._subs) { s.dispose(); }
        for (const d of this._vsDisposables) { d.dispose(); }
    }
}

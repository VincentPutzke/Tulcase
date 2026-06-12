/**
 * Persistent storage for the GitLab Personal Access Token using VS Code's
 * encrypted `SecretStorage`.  The token never lands in `settings.json`,
 * workspace state, or the Tulcase data directory (so it is never git-synced).
 */

import * as vscode from 'vscode';

export const PIPE_SECRET_KEY = 'tulcase.pipe.gitlab.token';

export class GitLabSecrets implements vscode.Disposable {
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChange = this._onDidChange.event;

    private readonly _listener: vscode.Disposable;

    constructor(private readonly secrets: vscode.SecretStorage) {
        this._listener = secrets.onDidChange(e => {
            if (e.key === PIPE_SECRET_KEY) { this._onDidChange.fire(); }
        });
    }

    async getToken(): Promise<string | undefined> {
        return this.secrets.get(PIPE_SECRET_KEY);
    }

    async setToken(token: string): Promise<void> {
        const trimmed = token.trim();
        if (trimmed) {
            await this.secrets.store(PIPE_SECRET_KEY, trimmed);
        } else {
            await this.secrets.delete(PIPE_SECRET_KEY);
        }
    }

    async clearToken(): Promise<void> {
        await this.secrets.delete(PIPE_SECRET_KEY);
    }

    /**
     * Gate an action on a stored token: when none exists, offer to set one.
     * Returns true when a token is available afterwards.
     */
    async ensureToken(actionDescription: string): Promise<boolean> {
        if (await this.getToken()) { return true; }
        const pick = await vscode.window.showWarningMessage(
            `${actionDescription} requires a GitLab token.`,
            'Set Token',
        );
        if (pick === 'Set Token') {
            await vscode.commands.executeCommand('tulcase.pipe.setToken');
            return Boolean(await this.getToken());
        }
        return false;
    }

    /** Prompt the user for a token via input box and persist it. */
    async promptAndStore(): Promise<string | undefined> {
        const value = await vscode.window.showInputBox({
            title: 'Tulcase Pipe — GitLab Personal Access Token',
            prompt: 'Paste a GitLab PAT with `api` scope (or `read_api` for read-only use).',
            password: true,
            ignoreFocusOut: true,
            placeHolder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
            validateInput: v => {
                const t = v.trim();
                if (!t) { return 'Token is required.'; }
                if (t.length < 20) { return 'Token looks too short.'; }
                return undefined;
            },
        });
        if (value === undefined) { return undefined; }
        await this.setToken(value);
        return value.trim();
    }

    dispose(): void {
        this._listener.dispose();
        this._onDidChange.dispose();
    }
}

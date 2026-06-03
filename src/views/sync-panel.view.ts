/**
 * Sync panel webview provider.
 *
 * Renders the git-sync configuration and action panel.  Unlike the other
 * views it has no tree/list — just a form, status display, and buttons.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SyncService, SyncState } from '../sync/sync-service';
import * as cfg from '../sync/sync-config';

export class SyncPanelViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tulcase.sync';

    private _view: vscode.WebviewView | undefined;

    constructor(
        private readonly syncService: SyncService,
        private readonly secrets: vscode.SecretStorage,
    ) {
        // Forward state changes to the webview
        this.syncService.onStateChanged(state => this._sendState(state));
    }

    // ── WebviewViewProvider ────────────────────────────────────────────────────

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html    = this._buildHtml();

        webviewView.webview.onDidReceiveMessage(msg => this._handleMessage(msg));

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                void this._sendInitialData();
            }
        });
    }

    /** Refresh the panel state from the service. */
    refresh(): void {
        void this.syncService.refreshState();
    }

    // ── Message handling ───────────────────────────────────────────────────────

    private async _handleMessage(msg: Record<string, unknown>): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendInitialData();
                break;

            case 'commit':
                await this.syncService.commit();
                break;

            case 'push':
                await this.syncService.push();
                break;

            case 'pull':
                await this.syncService.pull();
                break;

            case 'fullSync': {
                const ok = await this.syncService.setup();
                if (ok) {
                    await this.syncService.fullSync();
                }
                break;
            }

            case 'openSetup':
                await this._runSetupWizard();
                break;

            case 'setAutoSync':
                await cfg.setAutoSync(msg.enabled as boolean);
                break;
        }
    }

    // ── Setup wizard (native VS Code inputs) ───────────────────────────────────

    private async _runSetupWizard(): Promise<void> {
        // 1. Repository URL
        const currentUrl = cfg.getRepoUrl();
        const repoUrl = await vscode.window.showInputBox({
            title: 'Tulcase Sync Setup (1/3)',
            prompt: 'Repository URL (HTTPS)',
            value: currentUrl,
            placeHolder: 'https://github.com/user/tulcase-data.git',
            ignoreFocusOut: true,
        });
        if (repoUrl === undefined) { return; }  // cancelled

        // 2. PAT
        const pat = await vscode.window.showInputBox({
            title: 'Tulcase Sync Setup (2/3)',
            prompt: 'Personal Access Token (PAT)',
            placeHolder: 'ghp_… or glpat-…',
            password: true,
            ignoreFocusOut: true,
        });
        if (pat === undefined) { return; }  // cancelled

        // Save config
        await cfg.setRepoUrl(repoUrl.trim());
        if (pat) {
            await cfg.setPat(this.secrets, pat);
        }

        // 3. Mode
        const mode = await vscode.window.showQuickPick(
            [
                { label: '$(cloud-download) Keep Local & Sync', description: 'Merge existing local data with the remote', value: 'keep' },
                { label: '$(trash) Use Remote (Reset)', description: 'Discard all local data — download from remote', value: 'reset' },
            ],
            {
                title: 'Tulcase Sync Setup (3/3)',
                placeHolder: 'How should this machine be initialised?',
                ignoreFocusOut: true,
            },
        );
        if (!mode) { return; }  // cancelled

        if ((mode as { value: string }).value === 'reset') {
            const confirm = await vscode.window.showWarningMessage(
                'This will delete ALL local Tulcase data and replace it with the remote repository. Continue?',
                { modal: true },
                'Reset to Remote',
            );
            if (confirm !== 'Reset to Remote') { return; }
            await this.syncService.resetToRemote();
        } else {
            const ok = await this.syncService.setup();
            if (ok) {
                await this.syncService.fullSync();
            }
        }

        await this.syncService.refreshState();
    }

    // ── Data push ──────────────────────────────────────────────────────────────

    private async _sendInitialData(): Promise<void> {
        if (!this._view) { return; }

        await this.syncService.refreshState();

        const autoSync = cfg.getAutoSync();

        this._view.webview.postMessage({
            type    : 'updateConfig',
            autoSync,
        });

        this._sendState(this.syncService.state);
    }

    private _sendState(state: SyncState): void {
        if (!this._view?.visible) { return; }
        this._view.webview.postMessage({ type: 'updateState', state });
    }

    // ── HTML builder ───────────────────────────────────────────────────────────

    private _buildHtml(): string {
        const nonce  = getNonce();
        const outDir = path.join(__dirname);

        const htmlTemplate = fs.readFileSync(
            path.join(outDir, 'sync-panel.html'), 'utf-8',
        );
        const css = fs.readFileSync(
            path.join(outDir, 'sync-panel.css'), 'utf-8',
        );

        return htmlTemplate
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('{{STYLE}}', css);
    }
}

function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars[Math.floor(Math.random() * chars.length)];
    }
    return nonce;
}

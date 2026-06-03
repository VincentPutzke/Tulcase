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

            case 'saveConfig':
                await cfg.setRepoUrl(msg.repoUrl as string);
                if (msg.pat) {
                    await cfg.setPat(this.secrets, msg.pat as string);
                }
                await this.syncService.refreshState();
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
                // Setup first if not yet a git repo
                const ok = await this.syncService.setup();
                if (ok) {
                    await this.syncService.fullSync();
                }
                break;
            }

            case 'setupKeepLocal': {
                // Keep local data, merge with remote
                const ok2 = await this.syncService.setup();
                if (ok2) {
                    await this.syncService.fullSync();
                }
                break;
            }

            case 'setupUseRemote': {
                // Discard local data and use remote
                await this.syncService.resetToRemote();
                break;
            }

            case 'setAutoSync':
                await cfg.setAutoSync(msg.enabled as boolean);
                break;
        }
    }

    // ── Data push ──────────────────────────────────────────────────────────────

    private async _sendInitialData(): Promise<void> {
        if (!this._view) { return; }

        await this.syncService.refreshState();

        const repoUrl  = cfg.getRepoUrl();
        const pat      = await cfg.getPat(this.secrets);
        const autoSync = cfg.getAutoSync();

        this._view.webview.postMessage({
            type    : 'updateConfig',
            repoUrl,
            hasPat  : pat.length > 0,
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

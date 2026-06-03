import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { TulcaseSettings } from '../config';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

/**
 * Abstract base class for list-style WebviewViewProviders.
 *
 * Shared across Notes, Links, Todos, and Commands.
 * Subclasses provide:
 *   - `viewName`       — basename for the HTML/CSS assets (e.g. 'note-list')
 *   - `_handleMessage`  — feature-specific message handling
 *   - `_sendData`       — push feature data to the webview
 */
export abstract class BaseListViewProvider implements vscode.WebviewViewProvider {
    protected _view?: vscode.WebviewView;

    constructor(
        protected readonly settings: TulcaseSettings,
        protected readonly tagTree: TagTreeProvider,
    ) {}

    /** Asset basename without extension, e.g. `'note-list'`. */
    protected abstract readonly viewName: string;

    /** Whether this view defaults to the activity bar (sidebar). Disables wide layout. */
    protected readonly sidebarMode: boolean = false;

    /** Handle a message from the webview. */
    protected abstract _handleMessage(msg: { type: string; id?: string }): Promise<void>;

    /** Push current data to the webview. */
    protected abstract _sendData(): Promise<void>;

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
    }

    /** Called from extension when the file watcher detects a change. */
    refresh(): void {
        if (this._view?.visible) {
            void this._sendData();
        }
    }

    // ── HTML builder ───────────────────────────────────────────────────────────

    protected _buildHtml(): string {
        const nonce  = getNonce();
        const outDir = path.join(__dirname);

        const htmlTemplate = fs.readFileSync(
            path.join(outDir, `${this.viewName}.html`), 'utf-8',
        );
        const css = fs.readFileSync(
            path.join(outDir, `${this.viewName}.css`), 'utf-8',
        );

        // Inject sidebar-mode class on body to disable wide layout in activity bar
        let html = htmlTemplate
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('{{STYLE}}', css);

        if (this.sidebarMode) {
            html = html.replace('<body>', '<body class="sidebar-mode">');
        }

        return html;
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Cryptographically random nonce for Content-Security-Policy. */
function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars[Math.floor(Math.random() * chars.length)];
    }
    return nonce;
}

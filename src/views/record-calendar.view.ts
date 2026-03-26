import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { JsonStore } from '../data/json-store';
import { parseTimeToMinutes, minutesToHHMM } from '../data/time-utils';
import type { TulcaseSettings } from '../config';
import type { RecordDb } from '../models/record.model';

const store = new JsonStore();

/**
 * WebviewViewProvider that renders a colourful monthly calendar for time records.
 *
 * Layout (two-column):
 *   Left  — Monthly grid, colour-coded by hours worked. Month navigation.
 *            Double-click a day → add-entry quick-input dialog.
 *   Right — Detail panel: month summary (total / avg), entries for selected day.
 *
 * HTML lives in src/views/record-calendar.html.
 * Styles live in src/views/record-calendar.scss (compiled to out/record-calendar.css).
 * Both are loaded from disk at runtime (out/ directory, next to extension.js).
 */
export class RecordCalendarViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tulcase.records';

    private _currentYear : number;
    private _currentMonth: number;
    private _view?: vscode.WebviewView;

    constructor(private readonly settings: TulcaseSettings) {
        const now = new Date();
        this._currentYear  = now.getFullYear();
        this._currentMonth = now.getMonth() + 1;
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
    }

    /** Called from extension when the file-watcher detects a record change. */
    refresh(): void {
        if (this._view?.visible) {
            void this._sendMonthData(this._currentYear, this._currentMonth);
        }
    }

    // ── Message handling ───────────────────────────────────────────────────────

    private async _handleMessage(
        msg: { type: string; year?: number; month?: number; dateStr?: string },
    ): Promise<void> {
        switch (msg.type) {
            case 'loadMonth':
                if (msg.year !== undefined && msg.month !== undefined) {
                    this._currentYear  = msg.year;
                    this._currentMonth = msg.month;
                    await this._sendMonthData(msg.year, msg.month);
                }
                break;
            case 'openAddDialog':
                if (msg.dateStr) {
                    await this._openAddDialog(msg.dateStr);
                }
                break;
        }
    }

    private async _sendMonthData(year: number, month: number): Promise<void> {
        if (!this._view) { return; }

        const filePath = path.join(
            this.settings.recordsDir,
            String(year),
            `${String(month).padStart(2, '0')}.json`,
        );
        const data = await store.read<RecordDb>(filePath, { year, month, days: {} });
        this._view.webview.postMessage({ type: 'updateData', year, month, data });
    }

    private async _openAddDialog(dateStr: string): Promise<void> {
        const timeStr = await vscode.window.showInputBox({
            prompt: `Time spent on ${dateStr} — e.g. 1:30, 1.5h, 90m`,
            placeHolder: '1:30',
        });
        if (!timeStr) { return; }

        let minutes: number;
        try {
            minutes = parseTimeToMinutes(timeStr);
        } catch {
            void vscode.window.showErrorMessage('Invalid time format — use e.g. 1:30, 1.5h, 90');
            return;
        }

        const notes = await vscode.window.showInputBox({
            prompt: 'Notes',
            placeHolder: 'What did you work on?',
        });
        if (notes === undefined) { return; }

        const [yearStr, monthStr] = dateStr.split('-');
        const year  = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        const filePath = path.join(
            this.settings.recordsDir,
            String(year),
            `${String(month).padStart(2, '0')}.json`,
        );
        const data = await store.read<RecordDb>(filePath, { year, month, days: {} });
        if (!data.days[dateStr]) { data.days[dateStr] = []; }
        data.days[dateStr].push({ time_spent_min: minutes, notes: notes ?? '' });
        await store.write(filePath, data);

        await this._sendMonthData(year, month);
        void vscode.window.showInformationMessage(`Logged ${minutesToHHMM(minutes)} on ${dateStr}`);
    }

    // ── HTML builder ───────────────────────────────────────────────────────────

    /**
     * Load the HTML template and compiled CSS from the out/ directory,
     * inject a fresh CSP nonce, and return the complete HTML string.
     *
     * Token substitution:
     *   {{NONCE}} → cryptographically random nonce (used in CSP + script tag)
     *   {{STYLE}} → compiled CSS (read from out/record-calendar.css)
     */
    private _buildHtml(): string {
        const nonce   = getNonce();
        const outDir  = path.join(__dirname);                        // = out/

        const htmlTemplate = fs.readFileSync(
            path.join(outDir, 'record-calendar.html'),
            'utf-8',
        );
        const css = fs.readFileSync(
            path.join(outDir, 'record-calendar.css'),
            'utf-8',
        );

        // Replace all occurrences of both tokens in one pass
        return htmlTemplate
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('{{STYLE}}', css);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Cryptographically random nonce for Content-Security-Policy inline scripts. */
function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars[Math.floor(Math.random() * chars.length)];
    }
    return nonce;
}


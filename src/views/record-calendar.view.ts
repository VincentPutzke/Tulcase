import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { JsonStore } from '../data/json-store';
import { parseTimeToMinutes, todayStr, minutesToHHMM } from '../data/time-utils';
import type { TulcaseSettings } from '../config';
import type { RecordDb } from '../models/record.model';

const store = new JsonStore();

/**
 * WebviewViewProvider for the Records / Time-tracking panel.
 *
 * Layout (single column, shared style):
 *   Top    — Add bar: "+ Log Time" (today) / "+ Another Day" (pick date).
 *   Middle — Monthly calendar grid with navigation, grid lines, binary colour
 *            coding (has-entry / no-entry), hover, today, and selection effects.
 *   Bottom — Month summary stats + entry list for the selected day, rendered
 *            with the shared tree-item component (edit / delete per entry).
 *
 * HTML: src/views/record-calendar.html
 * SCSS: src/views/record-calendar.scss (compiled → out/record-calendar.css)
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

    // ── Public palette entry-points ───────────────────────────────────────────

    /** Log time for today — prompts for duration + notes. */
    public addRecordToday(): void {
        void this._handleMessage({ type: 'addToday' });
    }

    /** Log time for a chosen date — prompts for date, then duration + notes. */
    public addRecordAnotherDay(): void {
        void this._handleMessage({ type: 'addAnotherDay' });
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
        msg: { type: string; year?: number; month?: number; dateStr?: string; index?: number },
    ): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendMonthData(this._currentYear, this._currentMonth);
                break;
            case 'loadMonth':
                if (msg.year !== undefined && msg.month !== undefined) {
                    this._currentYear  = msg.year;
                    this._currentMonth = msg.month;
                    await this._sendMonthData(msg.year, msg.month);
                }
                break;
            case 'addToday':
                await this._addRecord(todayStr());
                break;
            case 'addAnotherDay': {
                const dateStr = await vscode.window.showInputBox({
                    prompt:        'Date (YYYY-MM-DD)',
                    value:         todayStr(),
                    validateInput: val => /^\d{4}-\d{2}-\d{2}$/.test(val) ? null : 'Use YYYY-MM-DD format',
                });
                if (dateStr) { await this._addRecord(dateStr); }
                break;
            }
            case 'addToDate':
                if (msg.dateStr) { await this._addRecord(msg.dateStr); }
                break;
            case 'editEntry':
                if (msg.dateStr !== undefined && msg.index !== undefined) {
                    await this._editEntry(msg.dateStr, msg.index);
                }
                break;
            case 'deleteEntry':
                if (msg.dateStr !== undefined && msg.index !== undefined) {
                    await this._deleteEntry(msg.dateStr, msg.index);
                }
                break;
        }
    }

    // ── Data push ─────────────────────────────────────────────────────────────

    private async _sendMonthData(year: number, month: number): Promise<void> {
        if (!this._view) { return; }

        const data = await store.read<RecordDb>(this._monthPath(year, month), {
            year, month, days: {},
        });
        this._view.webview.postMessage({ type: 'updateData', year, month, data });
    }

    // ── Data operations ───────────────────────────────────────────────────────

    /** Prompt for duration + notes, then append a new entry to the given date. */
    private async _addRecord(dateStr: string): Promise<void> {
        const timeStr = await vscode.window.showInputBox({
            prompt:      `Time spent on ${dateStr} — e.g. 1:30, 1.5h, 90m`,
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
            prompt:      'Notes',
            placeHolder: 'What did you work on?',
        });
        if (notes === undefined) { return; }

        const [yearStr, monthStr] = dateStr.split('-');
        const year  = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        const filePath = this._monthPath(year, month);
        const data = await store.read<RecordDb>(filePath, { year, month, days: {} });
        if (!data.days[dateStr]) { data.days[dateStr] = []; }
        data.days[dateStr].push({ time_spent_min: minutes, notes: notes ?? '' });
        await store.write(filePath, data);

        // Switch to the entry's month so the user sees the result.
        this._currentYear  = year;
        this._currentMonth = month;
        await this._sendMonthData(year, month);
        void vscode.window.showInformationMessage(`Logged ${minutesToHHMM(minutes)} on ${dateStr}`);
    }

    /** Edit an existing entry at the given index within a day. */
    private async _editEntry(dateStr: string, index: number): Promise<void> {
        const [yearStr, monthStr] = dateStr.split('-');
        const year  = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        const filePath = this._monthPath(year, month);
        const data     = await store.read<RecordDb>(filePath, { year, month, days: {} });
        const entries  = data.days[dateStr];
        if (!entries?.[index]) { return; }

        const current = entries[index];

        const timeStr = await vscode.window.showInputBox({
            prompt: `Edit time for ${dateStr}`,
            value:  minutesToHHMM(current.time_spent_min),
        });
        if (!timeStr) { return; }

        let minutes: number;
        try {
            minutes = parseTimeToMinutes(timeStr);
        } catch {
            void vscode.window.showErrorMessage('Invalid time format.');
            return;
        }

        const notes = await vscode.window.showInputBox({
            prompt: 'Edit notes',
            value:  current.notes,
        });
        if (notes === undefined) { return; }

        entries[index] = { time_spent_min: minutes, notes };
        await store.write(filePath, data);
        await this._sendMonthData(year, month);
    }

    /** Delete an existing entry at the given index within a day. */
    private async _deleteEntry(dateStr: string, index: number): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Delete this time entry?', { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }

        const [yearStr, monthStr] = dateStr.split('-');
        const year  = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        const filePath = this._monthPath(year, month);
        const data     = await store.read<RecordDb>(filePath, { year, month, days: {} });
        const entries  = data.days[dateStr];
        if (!entries?.[index]) { return; }

        entries.splice(index, 1);
        if (entries.length === 0) { delete data.days[dateStr]; }
        await store.write(filePath, data);
        await this._sendMonthData(year, month);
        void vscode.window.showInformationMessage('Entry deleted.');
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Resolve the absolute path for a month's record file. */
    private _monthPath(year: number, month: number): string {
        return path.join(
            this.settings.recordsDir,
            String(year),
            `${String(month).padStart(2, '0')}.json`,
        );
    }

    /** Build the initial HTML from the template + compiled CSS, injecting a CSP nonce. */
    private _buildHtml(): string {
        const nonce  = getNonce();
        const outDir = path.join(__dirname);

        const htmlTemplate = fs.readFileSync(
            path.join(outDir, 'record-calendar.html'), 'utf-8',
        );
        const css = fs.readFileSync(
            path.join(outDir, 'record-calendar.css'), 'utf-8',
        );

        let html = htmlTemplate
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('{{STYLE}}', css);

        // Always inject sidebar-mode — records lives in the activity bar
        html = html.replace('<body>', '<body class="sidebar-mode">');

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


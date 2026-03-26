import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { JsonStore } from '../data/json-store';
import { pickTags } from '../data/tag-picker';
import { todayStr, tomorrowStr, addDays, formatDate } from '../data/time-utils';
import { generateId } from '../utils/id';
import type { ArbeitsplatzSettings } from '../config';
import type { TodoItem, TodoStore } from '../models/todo.model';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

/**
 * WebviewViewProvider that renders a rich TODO list with three sections:
 *   Active  — overdue + due today (not done)
 *   Upcoming — future date (not done)
 *   Done    — completed items
 *
 * Each item shows two lines (note + date/tags) with action buttons.
 * A search bar filters by text and tags.
 *
 * HTML lives in src/views/todo-list.html.
 * Styles live in src/views/todo-list.scss (compiled to out/todo-list.css).
 */
export class TodoListViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'arbeitsplatz.todos';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly settings: ArbeitsplatzSettings,
        private readonly tagTree: TagTreeProvider,
    ) {}

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

    // ── Stats (used by StatusBar) ─────────────────────────────────────────────

    /** Get summary counts for the status bar. */
    async getStats(): Promise<{ total: number; overdue: number; today: number }> {
        const data  = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const items = (data.items ?? []).filter(i => !i.done);
        const t     = todayStr();

        return {
            total:   items.length,
            overdue: items.filter(i => i.date < t).length,
            today:   items.filter(i => i.date === t).length,
        };
    }

    // ── Message handling ───────────────────────────────────────────────────────

    private async _handleMessage(msg: { type: string; id?: string }): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendData();
                break;
            case 'markDone':
                if (msg.id) { await this._setDone(msg.id, true); }
                break;
            case 'markUndone':
                if (msg.id) { await this._setDone(msg.id, false); }
                break;
            case 'postpone':
                if (msg.id) { await this._postpone(msg.id); }
                break;
            case 'edit':
                if (msg.id) { await this._editTodo(msg.id); }
                break;
            case 'delete':
                if (msg.id) { await this._deleteTodo(msg.id); }
                break;
            case 'addTodo':
                await this._addTodo();
                break;
            case 'quickAddTodo':
                await this._quickAddTodo();
                break;
        }
    }

    // ── Data push ─────────────────────────────────────────────────────────────

    /** Load todos + tag map and push to the webview. */
    private async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const data   = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const tagMap = await this.tagTree.getTagMap();

        // Ensure every item has an ID (backfill old items)
        let dirty = false;
        for (const item of data.items) {
            if (!item.id) {
                item.id = generateId('todo');
                dirty = true;
            }
        }
        if (dirty) {
            await store.write(this.settings.todosFile, data);
        }

        this._view.webview.postMessage({
            type:   'updateData',
            todos:  data.items,
            tagMap,
            today:  todayStr(),
        });
    }

    // ── Data operations ───────────────────────────────────────────────────────

    private async _setDone(id: string, done: boolean): Promise<void> {
        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }
        item.done = done;
        await store.write(this.settings.todosFile, data);
        await this._sendData();
    }

    private async _postpone(id: string): Promise<void> {
        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }
        item.date = addDays(item.date, 1);
        await store.write(this.settings.todosFile, data);
        await this._sendData();
    }

    private async _deleteTodo(id: string): Promise<void> {
        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `Delete "${item.note}"?`, { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }

        data.items = data.items.filter(i => i.id !== id);
        await store.write(this.settings.todosFile, data);
        await this._sendData();
    }

    private async _editTodo(id: string): Promise<void> {
        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        const field = await vscode.window.showQuickPick([
            { label: 'Note',   description: item.note },
            { label: 'Date',   description: item.date },
            { label: 'Tags',   description: item.tags.join(', ') },
            { label: 'Delete', description: 'Remove this todo' },
        ], { placeHolder: 'What to edit?' });

        if (!field) { return; }

        if (field.label === 'Note') {
            const v = await vscode.window.showInputBox({ prompt: 'New note', value: item.note });
            if (v !== undefined) { item.note = v; }
        } else if (field.label === 'Date') {
            const v = await vscode.window.showInputBox({
                prompt: 'New date (YYYY-MM-DD)',
                value: item.date,
                validateInput: val => /^\d{4}-\d{2}-\d{2}$/.test(val) ? null : 'Use YYYY-MM-DD format',
            });
            if (v) { item.date = v; }
        } else if (field.label === 'Tags') {
            const picked = await pickTags(this.tagTree, item.tags);
            if (picked) { item.tags = picked; }
        } else if (field.label === 'Delete') {
            const confirm = await vscode.window.showWarningMessage(
                `Delete "${item.note}"?`, { modal: true }, 'Delete',
            );
            if (confirm === 'Delete') {
                data.items = data.items.filter(i => i.id !== id);
            }
        }

        await store.write(this.settings.todosFile, data);
        await this._sendData();
    }

    private async _addTodo(): Promise<void> {
        const note = await vscode.window.showInputBox({
            prompt: 'Todo note',
            placeHolder: 'What do you need to do?',
        });
        if (!note) { return; }

        const dateStr = await vscode.window.showInputBox({
            prompt: 'Date (YYYY-MM-DD)',
            value: todayStr(),
            placeHolder: 'YYYY-MM-DD',
            validateInput: val => /^\d{4}-\d{2}-\d{2}$/.test(val) ? null : 'Use YYYY-MM-DD format',
        });
        if (!dateStr) { return; }

        const tags = await pickTags(this.tagTree) ?? [];

        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        data.items.push({ id: generateId('todo'), note, date: dateStr, done: false, tags });
        await store.write(this.settings.todosFile, data);
        await this._sendData();
        vscode.window.showInformationMessage(`Todo added: ${note}`);
    }

    private async _quickAddTodo(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt: 'Quick add todo (use #tag for tags, YYYY-MM-DD for date)',
            placeHolder: 'Fix bug #backend 2026-03-20',
        });
        if (!input) { return; }

        const { note, tags, date } = parseQuickInput(input);

        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        data.items.push({ id: generateId('todo'), note, date, done: false, tags });
        await store.write(this.settings.todosFile, data);
        await this._sendData();
        vscode.window.showInformationMessage(`Todo added: ${note}`);
    }

    // ── HTML builder ───────────────────────────────────────────────────────────

    /**
     * Load the HTML template and compiled CSS from the out/ directory,
     * inject a fresh CSP nonce, and return the complete HTML string.
     */
    private _buildHtml(): string {
        const nonce  = getNonce();
        const outDir = path.join(__dirname);

        const htmlTemplate = fs.readFileSync(
            path.join(outDir, 'todo-list.html'), 'utf-8',
        );
        const css = fs.readFileSync(
            path.join(outDir, 'todo-list.css'), 'utf-8',
        );

        return htmlTemplate
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('{{STYLE}}', css);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Parse quick-add input: extract #tags, YYYY-MM-DD date, remainder = note. */
function parseQuickInput(input: string): { note: string; tags: string[]; date: string } {
    const tags: string[] = [];
    let date = todayStr();

    const tagRegex  = /#\S+/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(input)) !== null) {
        tags.push(match[0]);
    }

    const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;
    const dateMatch = dateRegex.exec(input);
    if (dateMatch) { date = dateMatch[1]; }

    const note = input
        .replace(tagRegex, '')
        .replace(dateRegex, '')
        .replace(/\s+/g, ' ')
        .trim();

    return { note, tags, date };
}

/** Cryptographically random nonce for Content-Security-Policy. */
function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars[Math.floor(Math.random() * chars.length)];
    }
    return nonce;
}

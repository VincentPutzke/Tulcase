import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { pickTags } from '../data/tag-picker';
import { todayStr, addDays } from '../data/time-utils';
import { generateId } from '../utils/id';
import type { TodoStore } from '../models/todo.model';
import { BaseListViewProvider } from './base-list.view';

const store = new JsonStore();

export class TodoListViewProvider extends BaseListViewProvider {
    public static readonly viewType = 'tulcase.todos';
    protected readonly viewName = 'todo-list';

    // ── Public palette entry-points ───────────────────────────────────────────

    /** Open the guided add-todo dialog from the command palette. */
    public addTodoFromPalette(): void {
        void this._handleMessage({ type: 'addTodo' });
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

    protected async _handleMessage(msg: { type: string; id?: string }): Promise<void> {
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
    protected async _sendData(): Promise<void> {
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

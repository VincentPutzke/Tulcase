import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { todayStr } from '../data/time-utils';
import type { TulcaseSettings } from '../config';
import type { TodoStore } from '../models/todo.model';
import type { TodoListViewProvider } from '../views/todo-list.view';
import type { TagTreeProvider as _TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

/**
 * Register TODO commands for the command palette / keybindings.
 *
 * `tulcase.todo.add`      — guided note → date → tags dialog (works from palette).
 * `tulcase.todo.quickAdd` — single-line quick-add (Ctrl+Shift+T); hidden from palette.
 *
 * Webview-internal actions (markDone, postpone, delete, etc.) are handled by
 * TodoListViewProvider via webview message passing and are not registered here.
 */
export function registerTodoCommands(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    todoList: TodoListViewProvider,
    _tagTree: _TagTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.todo.add', () => {
            todoList.addTodoFromPalette();
        }),
        vscode.commands.registerCommand('tulcase.todo.quickAdd', () =>
            quickAddTodo(settings, todoList),
        ),
    );
}

async function quickAddTodo(settings: TulcaseSettings, todoList: TodoListViewProvider): Promise<void> {
    const input = await vscode.window.showInputBox({
        prompt: 'Quick add todo (use #tag for tags, YYYY-MM-DD for date)',
        placeHolder: 'Fix bug #backend 2026-03-20',
    });
    if (!input) { return; }

    const { note, tags, date } = parseQuickInput(input);

    const data = await store.read<TodoStore>(settings.todosFile, { items: [] });
    const { generateId } = await import('../utils/id');
    data.items.push({ id: generateId('todo'), note, date, done: false, tags });
    await store.write(settings.todosFile, data);
    todoList.refresh();
    vscode.window.showInformationMessage(`Todo added: ${note}`);
}

function parseQuickInput(input: string): { note: string; tags: string[]; date: string } {
    const tags: string[] = [];
    let date = todayStr();

    const tagRegex = /#\S+/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(input)) !== null) {
        tags.push(match[0]);
    }

    const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;
    const dateMatch = dateRegex.exec(input);
    if (dateMatch) {
        date = dateMatch[1];
    }

    const note = input
        .replace(tagRegex, '')
        .replace(dateRegex, '')
        .replace(/\s+/g, ' ')
        .trim();

    return { note, tags, date };
}

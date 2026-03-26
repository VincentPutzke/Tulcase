import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { todayStr } from '../data/time-utils';
import type { ArbeitsplatzSettings } from '../config';
import type { TodoStore } from '../models/todo.model';
import type { TodoListViewProvider } from '../views/todo-list.view';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

/**
 * Register TODO commands that are invoked from the command palette / keybindings.
 * Webview-internal actions (markDone, postpone, etc.) are handled directly
 * by the TodoListViewProvider via message passing.
 */
export function registerTodoCommands(
    context: vscode.ExtensionContext,
    settings: ArbeitsplatzSettings,
    todoList: TodoListViewProvider,
    tagTree: TagTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.todo.add', () => {
            // Delegate to the webview provider (opens input dialogs + updates data)
            todoList.refresh();
        }),
        vscode.commands.registerCommand('arbeitsplatz.todo.quickAdd', () => quickAddTodo(settings, todoList)),
        vscode.commands.registerCommand('arbeitsplatz.todo.toggleShowDone', () => {
            // In the webview, done section is collapsible in the UI directly — this is a noop now
            vscode.window.showInformationMessage('Use the Done section toggle inside the TODO view.');
        }),
    );
}

async function quickAddTodo(settings: ArbeitsplatzSettings, todoList: TodoListViewProvider): Promise<void> {
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

    let note = input
        .replace(tagRegex, '')
        .replace(dateRegex, '')
        .replace(/\s+/g, ' ')
        .trim();

    return { note, tags, date };
}

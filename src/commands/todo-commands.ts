import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { todayStr, tomorrowStr, addDays, formatDate } from '../data/time-utils';
import type { ArbeitsplatzSettings } from '../config';
import type { TodoStore, TodoItem } from '../models/todo.model';
import type { TodoTreeProvider, TodoTreeItem } from '../providers/todo-tree.provider';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

export function registerTodoCommands(
    context: vscode.ExtensionContext,
    settings: ArbeitsplatzSettings,
    todoTree: TodoTreeProvider,
    tagTree: TagTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.todo.add', () => addTodo(settings, todoTree, tagTree)),
        vscode.commands.registerCommand('arbeitsplatz.todo.quickAdd', () => quickAddTodo(settings, todoTree)),
        vscode.commands.registerCommand('arbeitsplatz.todo.markDone', (item: TodoTreeItem) => setDone(settings, todoTree, item, true)),
        vscode.commands.registerCommand('arbeitsplatz.todo.markUndone', (item: TodoTreeItem) => setDone(settings, todoTree, item, false)),
        vscode.commands.registerCommand('arbeitsplatz.todo.moveToNextDay', (item: TodoTreeItem) => moveToNextDay(settings, todoTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.todo.reschedule', (item: TodoTreeItem) => reschedule(settings, todoTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.todo.edit', (item: TodoTreeItem) => editTodo(settings, todoTree, tagTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.todo.delete', (item: TodoTreeItem) => deleteTodo(settings, todoTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.todo.toggleShowDone', () => todoTree.toggleShowDone()),
    );
}

async function addTodo(settings: ArbeitsplatzSettings, todoTree: TodoTreeProvider, tagTree: TagTreeProvider): Promise<void> {
    const note = await vscode.window.showInputBox({ prompt: 'Todo note', placeHolder: 'What do you need to do?' });
    if (!note) { return; }

    const dateStr = await vscode.window.showInputBox({
        prompt: 'Date (YYYY-MM-DD)',
        value: todayStr(),
        placeHolder: 'YYYY-MM-DD',
        validateInput: val => /^\d{4}-\d{2}-\d{2}$/.test(val) ? null : 'Use YYYY-MM-DD format',
    });
    if (!dateStr) { return; }

    // Tag selection
    const tagMap = await tagTree.getTagMap();
    const tagNames = Object.keys(tagMap);
    let tags: string[] = [];
    if (tagNames.length > 0) {
        const picked = await vscode.window.showQuickPick(
            tagNames.map(t => ({ label: t })),
            { canPickMany: true, placeHolder: 'Select tags (optional)' }
        );
        tags = picked?.map(p => p.label) ?? [];
    }

    const data = await store.read<TodoStore>(settings.todosFile, { items: [] });
    data.items.push({ note, date: dateStr, done: false, tags });
    await store.write(settings.todosFile, data);
    todoTree.refresh();
    vscode.window.showInformationMessage(`Todo added: ${note}`);
}

async function quickAddTodo(settings: ArbeitsplatzSettings, todoTree: TodoTreeProvider): Promise<void> {
    const input = await vscode.window.showInputBox({
        prompt: 'Quick add todo (use #tag for tags, YYYY-MM-DD for date)',
        placeHolder: 'Fix bug #backend 2026-03-20',
    });
    if (!input) { return; }

    const { note, tags, date } = parseQuickInput(input);

    const data = await store.read<TodoStore>(settings.todosFile, { items: [] });
    data.items.push({ note, date, done: false, tags });
    await store.write(settings.todosFile, data);
    todoTree.refresh();
    vscode.window.showInformationMessage(`Todo added: ${note}`);
}

function parseQuickInput(input: string): { note: string; tags: string[]; date: string } {
    const tags: string[] = [];
    let date = todayStr();

    // Extract #tags
    const tagRegex = /#\S+/g;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(input)) !== null) {
        tags.push(match[0]);
    }

    // Extract date (YYYY-MM-DD)
    const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/;
    const dateMatch = dateRegex.exec(input);
    if (dateMatch) {
        date = dateMatch[1];
    }

    // Clean note: remove tags and date
    let note = input
        .replace(tagRegex, '')
        .replace(dateRegex, '')
        .replace(/\s+/g, ' ')
        .trim();

    return { note, tags, date };
}

async function setDone(settings: ArbeitsplatzSettings, todoTree: TodoTreeProvider, item: TodoTreeItem, done: boolean): Promise<void> {
    const data = await store.read<TodoStore>(settings.todosFile, { items: [] });
    const todo = data.items[item.index];
    if (todo) {
        todo.done = done;
        await store.write(settings.todosFile, data);
        todoTree.refresh();
    }
}

async function moveToNextDay(settings: ArbeitsplatzSettings, todoTree: TodoTreeProvider, item: TodoTreeItem): Promise<void> {
    const data = await store.read<TodoStore>(settings.todosFile, { items: [] });
    const todo = data.items[item.index];
    if (todo) {
        todo.date = addDays(todo.date, 1);
        await store.write(settings.todosFile, data);
        todoTree.refresh();
    }
}

async function reschedule(settings: ArbeitsplatzSettings, todoTree: TodoTreeProvider, item: TodoTreeItem): Promise<void> {
    const today = todayStr();
    const tomorrow = tomorrowStr();

    // Calculate next Monday
    const now = new Date();
    const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + daysUntilMonday);
    const nextMondayStr = formatDate(nextMonday);

    const choice = await vscode.window.showQuickPick([
        { label: 'Today', value: today },
        { label: 'Tomorrow', value: tomorrow },
        { label: 'Next Monday', value: nextMondayStr },
        { label: 'Pick date...', value: 'custom' },
    ], { placeHolder: 'Reschedule to...' });

    if (!choice) { return; }

    let newDate = choice.value;
    if (newDate === 'custom') {
        const picked = await vscode.window.showInputBox({
            prompt: 'Date (YYYY-MM-DD)',
            placeHolder: 'YYYY-MM-DD',
            validateInput: val => /^\d{4}-\d{2}-\d{2}$/.test(val) ? null : 'Use YYYY-MM-DD format',
        });
        if (!picked) { return; }
        newDate = picked;
    }

    const data = await store.read<TodoStore>(settings.todosFile, { items: [] });
    const todo = data.items[item.index];
    if (todo) {
        todo.date = newDate;
        await store.write(settings.todosFile, data);
        todoTree.refresh();
    }
}

async function editTodo(settings: ArbeitsplatzSettings, todoTree: TodoTreeProvider, tagTree: TagTreeProvider, item: TodoTreeItem): Promise<void> {
    const data = await store.read<TodoStore>(settings.todosFile, { items: [] });
    const todo = data.items[item.index];
    if (!todo) { return; }

    const field = await vscode.window.showQuickPick([
        { label: 'Note', description: todo.note },
        { label: 'Date', description: todo.date },
        { label: 'Tags', description: todo.tags.join(', ') },
    ], { placeHolder: 'What to edit?' });

    if (!field) { return; }

    if (field.label === 'Note') {
        const newNote = await vscode.window.showInputBox({ prompt: 'New note', value: todo.note });
        if (newNote !== undefined) {
            todo.note = newNote;
        }
    } else if (field.label === 'Date') {
        const newDate = await vscode.window.showInputBox({
            prompt: 'New date (YYYY-MM-DD)',
            value: todo.date,
            validateInput: val => /^\d{4}-\d{2}-\d{2}$/.test(val) ? null : 'Use YYYY-MM-DD format',
        });
        if (newDate) {
            todo.date = newDate;
        }
    } else if (field.label === 'Tags') {
        const tagMap = await tagTree.getTagMap();
        const allTags = Object.keys(tagMap);
        const picked = await vscode.window.showQuickPick(
            allTags.map(t => ({ label: t, picked: todo.tags.includes(t) })),
            { canPickMany: true, placeHolder: 'Select tags' }
        );
        if (picked) {
            todo.tags = picked.map(p => p.label);
        }
    }

    await store.write(settings.todosFile, data);
    todoTree.refresh();
}

async function deleteTodo(settings: ArbeitsplatzSettings, todoTree: TodoTreeProvider, item: TodoTreeItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `Delete "${item.todo.note}"?`,
        { modal: true },
        'Delete'
    );
    if (confirm !== 'Delete') { return; }

    const data = await store.read<TodoStore>(settings.todosFile, { items: [] });
    data.items.splice(item.index, 1);
    await store.write(settings.todosFile, data);
    todoTree.refresh();
}

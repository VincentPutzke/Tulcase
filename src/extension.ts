import * as vscode from 'vscode';
import { buildSettings } from './config';
import { syncRecurringTodos } from './data/recurring-sync';
import { DataFileWatcher } from './watchers/file-watcher';
import { TodoTreeProvider } from './providers/todo-tree.provider';
import { TagTreeProvider } from './providers/tag-tree.provider';
import { CommandTreeProvider } from './providers/command-tree.provider';
import { LinkTreeProvider } from './providers/link-tree.provider';
import { ListTreeProvider } from './providers/list-tree.provider';
import { RecordTreeProvider } from './providers/record-tree.provider';
import { registerTodoCommands } from './commands/todo-commands';
import { registerTagCommands } from './commands/tag-commands';
import { registerCommandCommands } from './commands/command-commands';
import { registerLinkCommands } from './commands/link-commands';
import { registerListCommands } from './commands/list-commands';
import { registerRecordCommands } from './commands/record-commands';
import { StatusBar } from './views/status-bar';

export function activate(context: vscode.ExtensionContext): void {
    // 1. Resolve settings
    const settings = buildSettings();

    // 2. Initialize tree data providers
    const todoTree = new TodoTreeProvider(settings);
    const tagTree = new TagTreeProvider(settings);
    const commandTree = new CommandTreeProvider(settings);
    const linkTree = new LinkTreeProvider(settings);
    const listTree = new ListTreeProvider(settings);
    const recordTree = new RecordTreeProvider(settings);

    // 3. Register tree views
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('arbeitsplatz.todos', todoTree),
        vscode.window.registerTreeDataProvider('arbeitsplatz.tags', tagTree),
        vscode.window.registerTreeDataProvider('arbeitsplatz.commands', commandTree),
        vscode.window.registerTreeDataProvider('arbeitsplatz.links', linkTree),
        vscode.window.registerTreeDataProvider('arbeitsplatz.lists', listTree),
        vscode.window.registerTreeDataProvider('arbeitsplatz.records', recordTree),
    );

    // 4. Refresh all trees helper
    const refreshAll = () => {
        todoTree.refresh();
        tagTree.refresh();
        commandTree.refresh();
        linkTree.refresh();
        listTree.refresh();
        recordTree.refresh();
        statusBar.update();
    };

    // 5. Register commands
    registerTodoCommands(context, settings, todoTree, tagTree);
    registerTagCommands(context, settings, tagTree, refreshAll);
    registerCommandCommands(context, settings, commandTree, tagTree);
    registerLinkCommands(context, settings, linkTree);
    registerListCommands(context, settings, listTree, tagTree);
    registerRecordCommands(context, settings, recordTree);

    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.refresh', refreshAll),
        vscode.commands.registerCommand('arbeitsplatz.openDashboard', () => {
            vscode.window.showInformationMessage('Dashboard webview coming in Phase 3!');
        }),
    );

    // 6. Status bar
    const statusBar = new StatusBar(todoTree);
    context.subscriptions.push(statusBar);

    // 7. File watcher for cross-instance sync
    const watcher = new DataFileWatcher(settings);
    watcher.onTodosChanged(() => { todoTree.refresh(); statusBar.update(); });
    watcher.onTagsChanged(() => tagTree.refresh());
    watcher.onCommandsChanged(() => commandTree.refresh());
    watcher.onLinksChanged(() => linkTree.refresh());
    watcher.onListsChanged(() => listTree.refresh());
    watcher.onRecordsChanged(() => recordTree.refresh());
    watcher.onRecurringChanged(() => todoTree.refresh());
    context.subscriptions.push(watcher);

    // 8. Run recurring sync on activation
    syncRecurringTodos(settings).then(() => {
        todoTree.refresh();
        statusBar.update();
    }).catch(err => {
        console.warn('Recurring sync failed:', err);
    });

    console.log('Arbeitsplatz extension activated. Data directory:', settings.baseDir);
}

export function deactivate(): void {
    // Cleanup handled by disposables
}

import * as vscode from 'vscode';
import { buildSettings } from './config';
import { syncRecurringTodos } from './data/recurring-sync';

// Suppress benign Node.js deprecation / experimental warnings that appear in
// the extension host console on startup and alarm users needlessly.
// The `punycode` deprecation originates in transitive dependencies; the SQLite
// warning comes from Node.js ≥22's built-in module, used internally by VS Code.
(function suppressKnownWarnings() {
    const _emit = process.emitWarning.bind(process);
    process.emitWarning = (warning: string | Error, ...args: unknown[]) => {
        const msg = typeof warning === 'object' ? (warning as Error).message : String(warning);
        if (
            msg.includes('DEP0040') ||                  // punycode
            msg.includes('punycode') ||
            msg.includes('SQLite is an experimental')   // Node ≥22 built-in sqlite
        ) {
            return;
        }
        return (_emit as (...a: unknown[]) => void)(warning, ...args);
    };
})();
import { DataFileWatcher } from './watchers/file-watcher';
import { TodoListViewProvider } from './views/todo-list.view';
import { TagTreeProvider } from './providers/tag-tree.provider';
import { CommandListViewProvider } from './views/command-list.view';
import { LinkTreeProvider } from './providers/link-tree.provider';
import { ListTreeProvider } from './providers/list-tree.provider';
import { RecordCalendarViewProvider } from './views/record-calendar.view';
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

    // 2. Initialize providers (tagTree first — todoList uses it for colour lookups)
    const tagTree     = new TagTreeProvider(settings);
    const todoList    = new TodoListViewProvider(settings, tagTree);
    const commandList = new CommandListViewProvider(settings, tagTree);
    const linkTree    = new LinkTreeProvider(settings);
    const listTree    = new ListTreeProvider(settings);
    // Records uses a webview calendar instead of a plain tree
    const recordCalendar = new RecordCalendarViewProvider(settings);

    // 3. Register tree views + webview views
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            TodoListViewProvider.viewType,
            todoList,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        vscode.window.registerTreeDataProvider('arbeitsplatz.tags', tagTree),
        vscode.window.registerWebviewViewProvider(
            CommandListViewProvider.viewType,
            commandList,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        vscode.window.registerTreeDataProvider('arbeitsplatz.links', linkTree),
        vscode.window.registerTreeDataProvider('arbeitsplatz.lists', listTree),
        vscode.window.registerWebviewViewProvider(
            RecordCalendarViewProvider.viewType,
            recordCalendar,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
    );

    // 4. Refresh all providers helper
    const refreshAll = () => {
        todoList.refresh();
        tagTree.refresh();
        commandList.refresh();
        linkTree.refresh();
        listTree.refresh();
        recordCalendar.refresh();
        statusBar.update();
    };

    // 5. Register commands
    registerTodoCommands(context, settings, todoList, tagTree);
    registerTagCommands(context, settings, tagTree, refreshAll);
    registerCommandCommands(context, settings, commandList, tagTree);
    registerLinkCommands(context, settings, linkTree);
    registerListCommands(context, settings, listTree, tagTree);
    registerRecordCommands(context, settings, recordCalendar);

    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.refresh', refreshAll),
        vscode.commands.registerCommand('arbeitsplatz.openDashboard', () => {
            vscode.window.showInformationMessage('Dashboard webview coming in Phase 3!');
        }),
    );

    // 6. Status bar
    const statusBar = new StatusBar(todoList);
    context.subscriptions.push(statusBar);

    // 7. File watcher for cross-instance sync
    const watcher = new DataFileWatcher(settings);
    watcher.onTodosChanged(() => { todoList.refresh(); statusBar.update(); });
    watcher.onTagsChanged(() => tagTree.refresh());
    watcher.onCommandsChanged(() => commandList.refresh());
    watcher.onLinksChanged(() => linkTree.refresh());
    watcher.onListsChanged(() => listTree.refresh());
    watcher.onRecordsChanged(() => recordCalendar.refresh());
    watcher.onRecurringChanged(() => todoList.refresh());
    context.subscriptions.push(watcher);

    // 8. Run recurring sync on activation
    syncRecurringTodos(settings).then(() => {
        todoList.refresh();
        statusBar.update();
    }).catch(err => {
        console.warn('Recurring sync failed:', err);
    });

    console.log('Arbeitsplatz extension activated. Data directory:', settings.baseDir);
}

export function deactivate(): void {
    // Cleanup handled by disposables
}

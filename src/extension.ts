import * as vscode from 'vscode';
import { buildSettings, ensureInitialized } from './config';
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
import { LinkListViewProvider } from './views/link-list.view';
import { NoteListViewProvider } from './views/note-list.view';
import { NoteFileSystemProvider } from './data/note-fs';
import { NoteTagDecorator } from './data/note-decorations';
import { NoteFormattingProvider, NOTE_DOCUMENT_SELECTOR } from './data/note-format';
import { RecordCalendarViewProvider } from './views/record-calendar.view';
import { registerTodoCommands } from './commands/todo-commands';
import { registerTagCommands } from './commands/tag-commands';
import { registerCommandCommands } from './commands/command-commands';
import { registerLinkCommands } from './commands/link-commands';
import { registerListCommands } from './commands/list-commands';
import { registerRecordCommands } from './commands/record-commands';
import { registerDbCommands } from './commands/db-commands';
import { StatusBar } from './views/status-bar';

export function activate(context: vscode.ExtensionContext): void {
    // 1. Initialise database layout + resolve settings
    const settings = buildSettings();
    ensureInitialized(settings.rootDir);
    // Re-derive paths in case migration changed the active db
    Object.assign(settings, buildSettings(settings.rootDir));

    // 2. Initialize providers (tagTree first — todoList uses it for colour lookups)
    const tagTree     = new TagTreeProvider(settings);
    const todoList    = new TodoListViewProvider(settings, tagTree);
    const commandList = new CommandListViewProvider(settings, tagTree);
    const linkList    = new LinkListViewProvider(settings, tagTree);
    const noteList    = new NoteListViewProvider(settings, tagTree);
    const noteFs      = new NoteFileSystemProvider(settings);
    const noteDecorator = new NoteTagDecorator(tagTree);
    // Records uses a webview calendar instead of a plain tree
    const recordCalendar = new RecordCalendarViewProvider(settings);

    // 3. Register tree views + webview views
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            TodoListViewProvider.viewType,
            todoList,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        vscode.window.registerTreeDataProvider('tulcase.tags', tagTree),
        vscode.window.registerWebviewViewProvider(
            CommandListViewProvider.viewType,
            commandList,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        vscode.window.registerWebviewViewProvider(
            LinkListViewProvider.viewType,
            linkList,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        vscode.workspace.registerFileSystemProvider(NoteFileSystemProvider.scheme, noteFs),
        vscode.window.registerWebviewViewProvider(
            NoteListViewProvider.viewType,
            noteList,
            { webviewOptions: { retainContextWhenHidden: true } },
        ),
        vscode.languages.registerDocumentFormattingEditProvider(
            NOTE_DOCUMENT_SELECTOR,
            new NoteFormattingProvider(),
        ),
        noteDecorator,
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
        linkList.refresh();
        noteList.refresh();
        recordCalendar.refresh();
        statusBar.update();
    };

    // 5. Register commands
    registerTodoCommands(context, settings, todoList, tagTree);
    registerTagCommands(context, settings, tagTree, refreshAll);
    registerCommandCommands(context, settings, commandList, tagTree);
    registerLinkCommands(context, settings, linkList);
    registerListCommands(context, settings, noteList, tagTree);
    registerRecordCommands(context, settings, recordCalendar);
    registerDbCommands(context, settings, refreshAll);

    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.refresh', refreshAll),
    );

    // 6. Status bar
    const statusBar = new StatusBar(todoList, settings);
    context.subscriptions.push(statusBar);

    // 7. File watcher for cross-instance sync
    const watcher = new DataFileWatcher(settings);
    watcher.onTodosChanged(() => { todoList.refresh(); statusBar.update(); });
    watcher.onTagsChanged(() => tagTree.refresh());
    watcher.onCommandsChanged(() => commandList.refresh());
    watcher.onLinksChanged(() => linkList.refresh());
    watcher.onListsChanged(() => { noteList.refresh(); noteDecorator.refreshAll(); });
    watcher.onRecordsChanged(() => recordCalendar.refresh());
    watcher.onTagsChanged(() => noteDecorator.refreshAll());
    watcher.onRecurringChanged(() => todoList.refresh());
    context.subscriptions.push(watcher);

    // 8. Auto-save notes on tab close
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(e => {
            // Ensure aplist documents are always saved (no dirty prompt)
            if (e.document.uri.scheme === NoteFileSystemProvider.scheme) {
                e.waitUntil(Promise.resolve([]));
            }
        }),
        vscode.window.tabGroups.onDidChangeTabs(e => {
            // When a note tab is closed, auto-save its content
            for (const tab of e.closed) {
                if (
                    tab.input instanceof vscode.TabInputText &&
                    tab.input.uri.scheme === NoteFileSystemProvider.scheme
                ) {
                    // The FS provider's writeFile has already been called by VS Code
                    // on dirty-close; just refresh the sidebar to update line counts.
                    noteList.refresh();
                }
            }
        }),
    );

    // 9. Run recurring sync on activation
    syncRecurringTodos(settings).then(() => {
        todoList.refresh();
        statusBar.update();
    }).catch(err => {
        console.warn('Recurring sync failed:', err);
    });

    console.log('Tulcase extension activated. Data directory:', settings.baseDir);
}

export function deactivate(): void {
    // Cleanup handled by disposables
}

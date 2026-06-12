import * as vscode from 'vscode';
import * as path from 'path';
import type { TulcaseSettings } from '../config';

/**
 * Watches all data directories for changes and fires domain-specific refresh events.
 * Uses VS Code's FileSystemWatcher for cross-platform reliability.
 */
export class DataFileWatcher implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private pending = new Map<string, NodeJS.Timeout>();
    private selfWriteTimestamps = new Map<string, number>();

    private readonly _onTodosChanged = new vscode.EventEmitter<void>();
    private readonly _onTagsChanged = new vscode.EventEmitter<void>();
    private readonly _onCommandsChanged = new vscode.EventEmitter<void>();
    private readonly _onScriptsChanged = new vscode.EventEmitter<void>();
    private readonly _onLinksChanged = new vscode.EventEmitter<void>();
    private readonly _onListsChanged = new vscode.EventEmitter<void>();
    private readonly _onRecordsChanged = new vscode.EventEmitter<void>();
    private readonly _onRecurringChanged = new vscode.EventEmitter<void>();
    private readonly _onPipeScopesChanged = new vscode.EventEmitter<void>();

    readonly onTodosChanged = this._onTodosChanged.event;
    readonly onTagsChanged = this._onTagsChanged.event;
    readonly onCommandsChanged = this._onCommandsChanged.event;
    readonly onScriptsChanged = this._onScriptsChanged.event;
    readonly onLinksChanged = this._onLinksChanged.event;
    readonly onListsChanged = this._onListsChanged.event;
    readonly onRecordsChanged = this._onRecordsChanged.event;
    readonly onRecurringChanged = this._onRecurringChanged.event;
    readonly onPipeScopesChanged = this._onPipeScopesChanged.event;

    constructor(private settings: TulcaseSettings) {
        this.startWatching();
    }

    /** Mark a file path as self-written so the watcher ignores it. */
    markSelfWrite(filePath: string): void {
        this.selfWriteTimestamps.set(path.normalize(filePath), Date.now());
    }

    private startWatching(): void {
        const pattern = new vscode.RelativePattern(
            vscode.Uri.file(this.settings.baseDir),
            '**/*.json'
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidChange(uri => this.handleFileChange(uri));
        watcher.onDidCreate(uri => this.handleFileChange(uri));
        watcher.onDidDelete(uri => this.handleFileChange(uri));

        this.disposables.push(watcher);
        this.disposables.push(
            this._onTodosChanged, this._onTagsChanged, this._onCommandsChanged,
            this._onScriptsChanged, this._onLinksChanged, this._onListsChanged,
            this._onRecordsChanged, this._onRecurringChanged, this._onPipeScopesChanged
        );
    }

    private handleFileChange(uri: vscode.Uri): void {
        const filePath = path.normalize(uri.fsPath);

        // Skip self-triggered writes
        if (this.isSelfWrite(filePath)) {
            return;
        }

        // Debounce: batch rapid events per file
        const existing = this.pending.get(filePath);
        if (existing) {
            clearTimeout(existing);
        }

        this.pending.set(filePath, setTimeout(() => {
            this.pending.delete(filePath);
            this.refreshDomain(filePath);
        }, 100));
    }

    private isSelfWrite(filePath: string): boolean {
        const ts = this.selfWriteTimestamps.get(filePath);
        if (!ts) {
            return false;
        }
        if (Date.now() - ts < 500) {
            return true;
        }
        this.selfWriteTimestamps.delete(filePath);
        return false;
    }

    private refreshDomain(filePath: string): void {
        const normalized = filePath.replace(/\\/g, '/');

        if (normalized.includes('/todo_db/todos.json')) {
            this._onTodosChanged.fire();
        } else if (normalized.includes('/todo_db/recurring.json')) {
            this._onRecurringChanged.fire();
        } else if (normalized.includes('/tags_db/')) {
            this._onTagsChanged.fire();
        } else if (normalized.includes('/commands_db/')) {
            this._onCommandsChanged.fire();
        } else if (normalized.includes('/scripts_db/')) {
            this._onScriptsChanged.fire();
        } else if (normalized.includes('/links_db/')) {
            this._onLinksChanged.fire();
        } else if (normalized.includes('/lists_db/')) {
            this._onListsChanged.fire();
        } else if (normalized.includes('/records_db/')) {
            this._onRecordsChanged.fire();
        } else if (normalized.includes('/pipe_db/')) {
            this._onPipeScopesChanged.fire();
        }
    }

    dispose(): void {
        for (const timeout of this.pending.values()) {
            clearTimeout(timeout);
        }
        this.pending.clear();
        this.disposables.forEach(d => d.dispose());
    }
}

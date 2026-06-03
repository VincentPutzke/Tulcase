import * as vscode from 'vscode';
import type { TodoListViewProvider } from './todo-list.view';
import type { TulcaseSettings } from '../config';
import { readLastUpdated } from '../config';

/**
 * Status bar item showing todo count and overdue count.
 * Format: "📋 5 todos · 2 overdue"
 */
export class StatusBar implements vscode.Disposable {
    private item: vscode.StatusBarItem;

    constructor(
        private todoList: TodoListViewProvider,
        private settings: TulcaseSettings,
    ) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        // Clicking opens the database switch UI for quick switching
        this.item.command = 'tulcase.db.switch';
        this.update();
    }

    async update(): Promise<void> {
        const stats = await this.todoList.getStats();
        const dbName = this.settings.activeDb || 'default';
        let text = `$(database) ${dbName}  $(checklist) ${stats.total} todos`;
        if (stats.overdue > 0) {
            text += ` · ${stats.overdue} overdue`;
        }
        this.item.text = text;

        // Build tooltip with last-updated info
        const lastUpdated = readLastUpdated(this.settings.baseDir);
        let tooltip = `Tulcase — click to switch database`;
        if (lastUpdated) {
            const d = new Date(lastUpdated);
            const pad = (n: number) => String(n).padStart(2, '0');
            const ts = `${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            tooltip += `\nLast updated: ${ts}`;
        }
        this.item.tooltip = tooltip;
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }
}

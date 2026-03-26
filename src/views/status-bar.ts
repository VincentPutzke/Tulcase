import * as vscode from 'vscode';
import type { TodoListViewProvider } from './todo-list.view';

/**
 * Status bar item showing todo count and overdue count.
 * Format: "📋 5 todos · 2 overdue"
 */
export class StatusBar implements vscode.Disposable {
    private item: vscode.StatusBarItem;

    constructor(private todoList: TodoListViewProvider) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'arbeitsplatz.todos.focus';
        this.item.tooltip = 'Arbeitsplatz TODOs';
        this.update();
    }

    async update(): Promise<void> {
        const stats = await this.todoList.getStats();
        let text = `$(checklist) ${stats.total} todos`;
        if (stats.overdue > 0) {
            text += ` · ${stats.overdue} overdue`;
        }
        this.item.text = text;
        this.item.show();
    }

    dispose(): void {
        this.item.dispose();
    }
}

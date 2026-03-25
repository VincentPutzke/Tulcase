import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { todayStr, tomorrowStr, formatDisplayDate, parseDate } from '../data/time-utils';
import type { ArbeitsplatzSettings } from '../config';
import type { TodoItem, TodoStore } from '../models/todo.model';

type TodoTreeNode = DateBucket | TodoTreeItem;

/** A date-bucket group node (Overdue, Today, Tomorrow, etc.) */
class DateBucket extends vscode.TreeItem {
    constructor(
        public readonly bucketLabel: string,
        public readonly items: TodoTreeItem[],
        iconId: string
    ) {
        super(
            `${bucketLabel} (${items.length})`,
            items.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        this.iconPath = new vscode.ThemeIcon(iconId);
        this.contextValue = 'todoBucket';
    }
}

/** A single todo item in the tree */
export class TodoTreeItem extends vscode.TreeItem {
    constructor(public readonly todo: TodoItem, public readonly index: number) {
        super(todo.note, vscode.TreeItemCollapsibleState.None);

        this.description = todo.tags.length > 0 ? todo.tags.join(' ') : undefined;
        this.tooltip = `${todo.note}\nDate: ${formatDisplayDate(todo.date)}${todo.tags.length ? '\nTags: ' + todo.tags.join(', ') : ''}`;

        if (todo.done) {
            this.contextValue = 'todoItemDone';
            this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
        } else {
            this.contextValue = 'todoItem';
            this.iconPath = new vscode.ThemeIcon('circle-large-outline');
        }
    }
}

export class TodoTreeProvider implements vscode.TreeDataProvider<TodoTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TodoTreeNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private store = new JsonStore();
    private showDone = false;

    constructor(private settings: ArbeitsplatzSettings) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    toggleShowDone(): void {
        this.showDone = !this.showDone;
        this.refresh();
    }

    getTreeItem(element: TodoTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TodoTreeNode): Promise<TodoTreeNode[]> {
        if (element instanceof DateBucket) {
            return element.items;
        }

        if (element) {
            return [];
        }

        // Root level: build date buckets
        const data = await this.store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const items = data.items ?? [];
        const today = todayStr();
        const tomorrow = tomorrowStr();

        const overdue: TodoTreeItem[] = [];
        const todayItems: TodoTreeItem[] = [];
        const tomorrowItems: TodoTreeItem[] = [];
        const upcoming: TodoTreeItem[] = [];
        const done: TodoTreeItem[] = [];

        items.forEach((item, index) => {
            const treeItem = new TodoTreeItem(item, index);

            if (item.done) {
                done.push(treeItem);
                return;
            }

            if (item.date < today) {
                overdue.push(treeItem);
            } else if (item.date === today) {
                todayItems.push(treeItem);
            } else if (item.date === tomorrow) {
                tomorrowItems.push(treeItem);
            } else {
                upcoming.push(treeItem);
            }
        });

        const buckets: DateBucket[] = [];

        if (overdue.length > 0) {
            buckets.push(new DateBucket('Overdue', overdue, 'warning'));
        }
        buckets.push(new DateBucket('Today', todayItems, 'calendar'));
        if (tomorrowItems.length > 0) {
            buckets.push(new DateBucket('Tomorrow', tomorrowItems, 'calendar'));
        }
        if (upcoming.length > 0) {
            buckets.push(new DateBucket('Upcoming', upcoming, 'calendar'));
        }
        if (this.showDone && done.length > 0) {
            buckets.push(new DateBucket('Done', done, 'check-all'));
        }

        return buckets;
    }

    /** Get the total count of undone todos. */
    async getStats(): Promise<{ total: number; overdue: number; today: number }> {
        const data = await this.store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const items = (data.items ?? []).filter(i => !i.done);
        const todayDate = todayStr();

        return {
            total: items.length,
            overdue: items.filter(i => i.date < todayDate).length,
            today: items.filter(i => i.date === todayDate).length,
        };
    }
}

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import type { TulcaseSettings } from '../config';
import type { ListStore, MiniList, ListItem } from '../models/list.model';

type ListTreeNode = ListParentItem | ListChildItem;

/** A list (parent) in the tree */
export class ListParentItem extends vscode.TreeItem {
    constructor(public readonly list: MiniList) {
        const doneCount = list.items.filter(i => i.done).length;
        const totalCount = list.items.length;
        super(list.label, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = `${doneCount}/${totalCount}`;
        this.tooltip = `${list.label}${list.description ? '\n' + list.description : ''}\nProgress: ${doneCount}/${totalCount}`;
        this.contextValue = 'listParent';
        this.iconPath = new vscode.ThemeIcon('checklist');
    }
}

/** A list item (child) in the tree */
export class ListChildItem extends vscode.TreeItem {
    constructor(
        public readonly item: ListItem,
        public readonly parentListId: string
    ) {
        super(item.text, vscode.TreeItemCollapsibleState.None);
        this.description = item.tags.length > 0 ? item.tags.join(' ') : undefined;
        this.contextValue = item.done ? 'listItemDone' : 'listItem';
        this.iconPath = item.done
            ? new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'))
            : new vscode.ThemeIcon('circle-large-outline');
    }
}

export class ListTreeProvider implements vscode.TreeDataProvider<ListTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ListTreeNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private store = new JsonStore();

    constructor(private settings: TulcaseSettings) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ListTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ListTreeNode): Promise<ListTreeNode[]> {
        if (element instanceof ListParentItem) {
            return element.list.items.map(item => new ListChildItem(item, element.list.id));
        }
        if (element) {
            return [];
        }

        const data = await this.store.read<ListStore>(this.settings.listsFile, { lists: [] });
        return (data.lists ?? []).map(list => new ListParentItem(list));
    }
}

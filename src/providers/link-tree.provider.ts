import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import type { ArbeitsplatzSettings } from '../config';
import type { LinkStore, LinkNode } from '../models/link.model';

/** Tree item for a link or folder in the tree */
export class LinkTreeItem extends vscode.TreeItem {
    constructor(public readonly node: LinkNode) {
        super(
            node.label,
            node.type === 'folder'
                ? (node.expanded !== false ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed)
                : vscode.TreeItemCollapsibleState.None
        );

        if (node.type === 'link') {
            this.description = node.url;
            this.tooltip = `${node.label}\n${node.url ?? ''}${node.tags?.length ? '\nTags: ' + node.tags.join(', ') : ''}`;
            this.contextValue = 'linkItem';
            this.iconPath = new vscode.ThemeIcon('globe');
        } else {
            this.description = node.children ? `${node.children.length} items` : '';
            this.tooltip = node.label;
            this.contextValue = 'linkFolder';
            this.iconPath = new vscode.ThemeIcon('folder');
        }
    }
}

export class LinkTreeProvider implements vscode.TreeDataProvider<LinkTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<LinkTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private store = new JsonStore();

    constructor(private settings: ArbeitsplatzSettings) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: LinkTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: LinkTreeItem): Promise<LinkTreeItem[]> {
        if (element) {
            if (element.node.type === 'folder' && element.node.children) {
                return element.node.children.map(child => new LinkTreeItem(child));
            }
            return [];
        }

        const data = await this.store.read<LinkStore>(this.settings.linksFile, { root: [] });
        return (data.root ?? []).map(node => new LinkTreeItem(node));
    }
}

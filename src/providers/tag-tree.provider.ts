import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import type { TulcaseSettings } from '../config';
import type { TagStore, TagDef } from '../models/tag.model';

type TagTreeNode = TagCategory | TagTreeItem;

/** A category group node */
class TagCategory extends vscode.TreeItem {
    constructor(
        public readonly category: string,
        public readonly tagItems: TagTreeItem[]
    ) {
        super(category, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('tag');
        this.contextValue = 'tagCategory';
        this.description = `${tagItems.length}`;
    }
}

/** A single tag item */
export class TagTreeItem extends vscode.TreeItem {
    constructor(
        public readonly tagName: string,
        public readonly tagDef: TagDef
    ) {
        super(tagName, vscode.TreeItemCollapsibleState.None);
        this.description = tagDef.category;
        this.contextValue = 'tagItem';
        this.tooltip = `${tagName}\nColor: ${tagDef.color}\nCategory: ${tagDef.category}`;
        this.iconPath = colorCircleIcon(tagDef.color);
    }
}

function colorCircleIcon(hexColor: string): vscode.Uri {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${hexColor}"/></svg>`;
    return vscode.Uri.parse(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
}

export class TagTreeProvider implements vscode.TreeDataProvider<TagTreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TagTreeNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private store = new JsonStore();

    constructor(private settings: TulcaseSettings) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: TagTreeNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TagTreeNode): Promise<TagTreeNode[]> {
        if (element instanceof TagCategory) {
            return element.tagItems;
        }
        if (element) {
            return [];
        }

        const data = await this.store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        const tags = data.tags ?? {};

        // Group by category
        const categories = new Map<string, TagTreeItem[]>();
        for (const [name, def] of Object.entries(tags)) {
            const cat = def.category || 'general';
            if (!categories.has(cat)) {
                categories.set(cat, []);
            }
            categories.get(cat)!.push(new TagTreeItem(name, def));
        }

        // Sort categories alphabetically, items alphabetically within
        return Array.from(categories.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([cat, items]) => new TagCategory(cat, items.sort((a, b) => a.tagName.localeCompare(b.tagName))));
    }

    /** Get all tags as a flat map for lookups. */
    async getTagMap(): Promise<Record<string, TagDef>> {
        const data = await this.store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        return data.tags ?? {};
    }
}

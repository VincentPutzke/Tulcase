/**
 * WebviewViewProvider for the Tags sidebar panel.
 *
 * Renders tags grouped by category in the same visual style as TODOs, Commands,
 * Notes, and Links. Each tag card shows a colour swatch, the tag name, and inline
 * action buttons for rename, colour change, category change, and delete.
 *
 * HTML lives in src/views/tag-list.html.
 * Styles live in src/views/tag-list.scss (compiled to out/tag-list.css).
 */

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { stripTagFromAll, renameTagInAll } from '../data/tag-propagation';
import { DEFAULT_TAG_COLOR, DEFAULT_TAG_CATEGORY } from '../models/tag.model';
import type { TagStore } from '../models/tag.model';
import { BaseListViewProvider } from './base-list.view';

const store = new JsonStore();

/** Curated colour palette presented in the add/change-colour quick-pick. */
const TAG_COLORS = [
    { label: 'Red',     value: '#ff5c5c' },
    { label: 'Crimson', value: '#ff3333' },
    { label: 'Orange',  value: '#ffb547' },
    { label: 'Yellow',  value: '#ffd43b' },
    { label: 'Lime',    value: '#7bc67e' },
    { label: 'Green',   value: '#00e5a0' },
    { label: 'Teal',    value: '#20c997' },
    { label: 'Cyan',    value: '#00add8' },
    { label: 'Blue',    value: '#4dabf7' },
    { label: 'Indigo',  value: '#5c7cfa' },
    { label: 'Purple',  value: '#7c6aff' },
    { label: 'Violet',  value: '#845ef7' },
    { label: 'Magenta', value: '#cc5de8' },
    { label: 'Pink',    value: '#f06595' },
    { label: 'Rose',    value: '#ff8787' },
    { label: 'Gray',    value: '#8b8fa3' },
];

export class TagListViewProvider extends BaseListViewProvider {
    public static readonly viewType = 'tulcase.tags';
    protected readonly viewName = 'tag-list';

    // ── Public palette entry-points ───────────────────────────────────────────

    /** Open the add-tag dialog from the command palette or view title (+) button. */
    public addTagFromPalette(): void {
        void this._handleMessage({ type: 'addTag' });
    }

    // ── Message handling ───────────────────────────────────────────────────────

    protected async _handleMessage(msg: { type: string; id?: string }): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendData();
                break;
            case 'addTag':
                await this._addTag();
                break;
            case 'rename':
                if (msg.id) { await this._renameTag(msg.id); }
                break;
            case 'changeColor':
                if (msg.id) { await this._changeColor(msg.id); }
                break;
            case 'changeCategory':
                if (msg.id) { await this._changeCategory(msg.id); }
                break;
            case 'delete':
                if (msg.id) { await this._deleteTag(msg.id); }
                break;
        }
    }

    // ── Data push ─────────────────────────────────────────────────────────────

    /** Load tags and push the flat list to the webview. */
    protected async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        const tags = Object.entries(data.tags ?? {}).map(([name, def]) => ({
            name,
            color:    def.color,
            category: def.category || DEFAULT_TAG_CATEGORY,
        }));

        this._view.webview.postMessage({ type: 'updateData', tags });
    }

    // ── Data operations ───────────────────────────────────────────────────────

    private async _addTag(): Promise<void> {
        const input = await vscode.window.showInputBox({
            prompt:      'Tag name (e.g., #work)',
            placeHolder: '#mytag',
        });
        if (!input) { return; }

        const tagName = input.startsWith('#') ? input : `#${input}`;

        const colorChoice = await vscode.window.showQuickPick(
            TAG_COLORS.map(c => ({ label: `$(circle-filled) ${c.label}`, value: c.value, description: c.value })),
            { placeHolder: 'Pick a color' },
        );
        const color = colorChoice?.value ?? DEFAULT_TAG_COLOR;

        const existingCategories = await this._getExistingCategories();
        const category = await this._pickOrInputCategory(existingCategories);

        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        data.tags[tagName] = { color, category: category || DEFAULT_TAG_CATEGORY };
        await store.write(this.settings.tagsFile, data);

        this.tagTree.refresh();
        await this._sendData();
        vscode.window.showInformationMessage(`Tag created: ${tagName}`);
    }

    private async _renameTag(tagName: string): Promise<void> {
        const newInput = await vscode.window.showInputBox({
            prompt: `Rename "${tagName}" to…`,
            value:  tagName,
        });
        if (!newInput || newInput === tagName) { return; }

        const newName = newInput.startsWith('#') ? newInput : `#${newInput}`;

        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        const def  = data.tags[tagName];
        if (def) {
            delete data.tags[tagName];
            data.tags[newName] = def;
            await store.write(this.settings.tagsFile, data);
        }

        // Propagate rename across all stores (todos, commands, links, notes).
        await renameTagInAll(tagName, newName, this.settings);

        this.tagTree.refresh();
        await this._sendData();
        vscode.window.showInformationMessage(`Tag renamed: ${tagName} → ${newName}`);
    }

    private async _changeColor(tagName: string): Promise<void> {
        const colorChoice = await vscode.window.showQuickPick(
            TAG_COLORS.map(c => ({ label: `$(circle-filled) ${c.label}`, value: c.value, description: c.value })),
            { placeHolder: `Pick a new colour for ${tagName}` },
        );
        if (!colorChoice) { return; }

        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        if (data.tags[tagName]) {
            data.tags[tagName].color = colorChoice.value;
            await store.write(this.settings.tagsFile, data);
            this.tagTree.refresh();
            await this._sendData();
        }
    }

    private async _changeCategory(tagName: string): Promise<void> {
        const data             = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        const currentCategory  = data.tags[tagName]?.category;
        const existingCategories = await this._getExistingCategories();
        const newCategory      = await this._pickOrInputCategory(existingCategories, currentCategory);
        if (!newCategory) { return; }

        if (data.tags[tagName]) {
            data.tags[tagName].category = newCategory;
            await store.write(this.settings.tagsFile, data);
            this.tagTree.refresh();
            await this._sendData();
        }
    }

    private async _deleteTag(tagName: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            `Delete tag "${tagName}"? It will be removed from all items.`,
            { modal: true },
            'Delete',
        );
        if (confirm !== 'Delete') { return; }

        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        delete data.tags[tagName];
        await store.write(this.settings.tagsFile, data);

        // Propagate deletion across all stores.
        await stripTagFromAll(tagName, this.settings);

        this.tagTree.refresh();
        await this._sendData();
        vscode.window.showInformationMessage(`Tag deleted: ${tagName}`);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /** Collect all distinct categories currently stored. */
    private async _getExistingCategories(): Promise<string[]> {
        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        const cats = new Set<string>();
        for (const def of Object.values(data.tags)) {
            if (def.category) { cats.add(def.category); }
        }
        return [...cats].sort();
    }

    /**
     * Show a QuickPick with existing categories + a "New category…" option.
     * Returns the chosen/typed category name, or undefined if cancelled.
     */
    private async _pickOrInputCategory(
        existing: string[],
        currentValue?: string,
    ): Promise<string | undefined> {
        const NEW_OPTION = '$(add) New category…';
        const items = [
            ...existing.map(c => ({
                label:       c,
                description: c === currentValue ? '(current)' : undefined as string | undefined,
            })),
            { label: NEW_OPTION, description: undefined as string | undefined },
        ];

        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Pick a category' });
        if (!picked) { return undefined; }

        if (picked.label === NEW_OPTION) {
            return vscode.window.showInputBox({
                prompt:      'New category name',
                placeHolder: 'e.g. workflow',
            });
        }
        return picked.label;
    }
}

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { stripTagFromAll, renameTagInAll } from '../data/tag-propagation';
import { DEFAULT_TAG_COLOR, DEFAULT_TAG_CATEGORY } from '../models/tag.model';
import type { TulcaseSettings } from '../config';
import type { TagStore } from '../models/tag.model';
import type { TagTreeProvider, TagTreeItem } from '../providers/tag-tree.provider';

const store = new JsonStore();

/** Curated colour palette for tag quick-pick. */
const TAG_COLORS = [
    { label: 'Red',         value: '#ff5c5c' },
    { label: 'Crimson',     value: '#ff3333' },
    { label: 'Orange',      value: '#ffb547' },
    { label: 'Yellow',      value: '#ffd43b' },
    { label: 'Lime',        value: '#7bc67e' },
    { label: 'Green',       value: '#00e5a0' },
    { label: 'Teal',        value: '#20c997' },
    { label: 'Cyan',        value: '#00add8' },
    { label: 'Blue',        value: '#4dabf7' },
    { label: 'Indigo',      value: '#5c7cfa' },
    { label: 'Purple',      value: '#7c6aff' },
    { label: 'Violet',      value: '#845ef7' },
    { label: 'Magenta',     value: '#cc5de8' },
    { label: 'Pink',        value: '#f06595' },
    { label: 'Rose',        value: '#ff8787' },
    { label: 'Gray',        value: '#8b8fa3' },
];

export function registerTagCommands(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    tagTree: TagTreeProvider,
    refreshAll: () => void
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.tag.add', () => addTag(settings, tagTree)),
        vscode.commands.registerCommand('tulcase.tag.rename', (item: TagTreeItem) => renameTag(settings, tagTree, item, refreshAll)),
        vscode.commands.registerCommand('tulcase.tag.changeColor', (item: TagTreeItem) => changeColor(settings, tagTree, item)),
        vscode.commands.registerCommand('tulcase.tag.changeCategory', (item: TagTreeItem) => changeCategory(settings, tagTree, item)),
        vscode.commands.registerCommand('tulcase.tag.delete', (item: TagTreeItem) => deleteTag(settings, tagTree, item, refreshAll)),
    );
}

async function addTag(settings: TulcaseSettings, tagTree: TagTreeProvider): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Tag name (e.g., #work)', placeHolder: '#mytag' });
    if (!name) { return; }

    const tagName = name.startsWith('#') ? name : `#${name}`;

    const colorChoice = await vscode.window.showQuickPick(
        TAG_COLORS.map(c => ({ label: `$(circle-filled) ${c.label}`, value: c.value, description: c.value })),
        { placeHolder: 'Pick a color' }
    );
    const color = colorChoice?.value ?? DEFAULT_TAG_COLOR;

    // Suggest existing categories for consistency
    const existingCategories = await getExistingCategories(settings);
    const category = await pickOrInputCategory(existingCategories);

    const data = await store.read<TagStore>(settings.tagsFile, { tags: {} });
    data.tags[tagName] = { color, category: category || DEFAULT_TAG_CATEGORY };
    await store.write(settings.tagsFile, data);
    tagTree.refresh();
    vscode.window.showInformationMessage(`Tag created: ${tagName}`);
}

async function renameTag(
    settings: TulcaseSettings,
    tagTree: TagTreeProvider,
    item: TagTreeItem,
    refreshAll: () => void
): Promise<void> {
    const newName = await vscode.window.showInputBox({
        prompt: `Rename "${item.tagName}" to...`,
        value: item.tagName,
    });
    if (!newName || newName === item.tagName) { return; }

    const tagName = newName.startsWith('#') ? newName : `#${newName}`;

    // Update tag registry
    const data = await store.read<TagStore>(settings.tagsFile, { tags: {} });
    const def = data.tags[item.tagName];
    if (def) {
        delete data.tags[item.tagName];
        data.tags[tagName] = def;
        await store.write(settings.tagsFile, data);
    }

    // Propagate rename across all stores
    await renameTagInAll(item.tagName, tagName, settings);
    refreshAll();
    vscode.window.showInformationMessage(`Tag renamed: ${item.tagName} → ${tagName}`);
}

async function changeColor(settings: TulcaseSettings, tagTree: TagTreeProvider, item: TagTreeItem): Promise<void> {
    const colorChoice = await vscode.window.showQuickPick(
        TAG_COLORS.map(c => ({ label: `$(circle-filled) ${c.label}`, value: c.value, description: c.value })),
        { placeHolder: `Pick a new color for ${item.tagName}` }
    );
    if (!colorChoice) { return; }

    const data = await store.read<TagStore>(settings.tagsFile, { tags: {} });
    if (data.tags[item.tagName]) {
        data.tags[item.tagName].color = colorChoice.value;
        await store.write(settings.tagsFile, data);
        tagTree.refresh();
    }
}

async function deleteTag(
    settings: TulcaseSettings,
    tagTree: TagTreeProvider,
    item: TagTreeItem,
    refreshAll: () => void
): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `Delete tag "${item.tagName}"? It will be removed from all items.`,
        { modal: true },
        'Delete'
    );
    if (confirm !== 'Delete') { return; }

    // Remove from tag registry
    const data = await store.read<TagStore>(settings.tagsFile, { tags: {} });
    delete data.tags[item.tagName];
    await store.write(settings.tagsFile, data);

    // Propagate deletion across all stores
    await stripTagFromAll(item.tagName, settings);
    refreshAll();
    vscode.window.showInformationMessage(`Tag deleted: ${item.tagName}`);
}

async function changeCategory(
    settings: TulcaseSettings,
    tagTree: TagTreeProvider,
    item: TagTreeItem,
): Promise<void> {
    const existingCategories = await getExistingCategories(settings);
    const newCategory = await pickOrInputCategory(existingCategories, item.tagDef.category);
    if (!newCategory) { return; }

    const data = await store.read<TagStore>(settings.tagsFile, { tags: {} });
    if (data.tags[item.tagName]) {
        data.tags[item.tagName].category = newCategory;
        await store.write(settings.tagsFile, data);
        tagTree.refresh();
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect all distinct categories currently in use. */
async function getExistingCategories(settings: TulcaseSettings): Promise<string[]> {
    const data = await store.read<TagStore>(settings.tagsFile, { tags: {} });
    const cats = new Set<string>();
    for (const def of Object.values(data.tags)) {
        if (def.category) { cats.add(def.category); }
    }
    return [...cats].sort();
}

/**
 * Show a QuickPick with existing categories + a "New category…" option.
 * Returns the chosen or typed category name, or undefined if cancelled.
 */
async function pickOrInputCategory(
    existing: string[],
    currentValue?: string,
): Promise<string | undefined> {
    const NEW_OPTION = '$(add) New category…';
    const items = [
        ...existing.map(c => ({
            label: c,
            description: c === currentValue ? '(current)' : undefined,
        })),
        { label: NEW_OPTION, description: undefined as string | undefined },
    ];

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Pick a category',
    });
    if (!picked) { return undefined; }

    if (picked.label === NEW_OPTION) {
        return vscode.window.showInputBox({
            prompt: 'New category name',
            placeHolder: 'e.g. workflow',
        });
    }
    return picked.label;
}

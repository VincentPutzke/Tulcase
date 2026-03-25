import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { stripTagFromAll, renameTagInAll } from '../data/tag-propagation';
import { DEFAULT_TAG_COLOR, DEFAULT_TAG_CATEGORY } from '../models/tag.model';
import type { ArbeitsplatzSettings } from '../config';
import type { TagStore } from '../models/tag.model';
import type { TagTreeProvider, TagTreeItem } from '../providers/tag-tree.provider';

const store = new JsonStore();

const TAG_COLORS = [
    { label: 'Purple', value: '#7c6aff' },
    { label: 'Green', value: '#00e5a0' },
    { label: 'Blue', value: '#4dabf7' },
    { label: 'Orange', value: '#ffb547' },
    { label: 'Red', value: '#ff5c5c' },
    { label: 'Pink', value: '#f06595' },
    { label: 'Teal', value: '#20c997' },
    { label: 'Yellow', value: '#ffd43b' },
    { label: 'Gray', value: '#8b8fa3' },
    { label: 'Indigo', value: '#5c7cfa' },
];

export function registerTagCommands(
    context: vscode.ExtensionContext,
    settings: ArbeitsplatzSettings,
    tagTree: TagTreeProvider,
    refreshAll: () => void
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.tag.add', () => addTag(settings, tagTree)),
        vscode.commands.registerCommand('arbeitsplatz.tag.rename', (item: TagTreeItem) => renameTag(settings, tagTree, item, refreshAll)),
        vscode.commands.registerCommand('arbeitsplatz.tag.changeColor', (item: TagTreeItem) => changeColor(settings, tagTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.tag.delete', (item: TagTreeItem) => deleteTag(settings, tagTree, item, refreshAll)),
    );
}

async function addTag(settings: ArbeitsplatzSettings, tagTree: TagTreeProvider): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Tag name (e.g., #work)', placeHolder: '#mytag' });
    if (!name) { return; }

    const tagName = name.startsWith('#') ? name : `#${name}`;

    const colorChoice = await vscode.window.showQuickPick(
        TAG_COLORS.map(c => ({ label: `$(circle-filled) ${c.label}`, value: c.value, description: c.value })),
        { placeHolder: 'Pick a color' }
    );
    const color = colorChoice?.value ?? DEFAULT_TAG_COLOR;

    const category = await vscode.window.showInputBox({
        prompt: 'Category',
        value: DEFAULT_TAG_CATEGORY,
        placeHolder: 'general',
    });

    const data = await store.read<TagStore>(settings.tagsFile, { tags: {} });
    data.tags[tagName] = { color, category: category || DEFAULT_TAG_CATEGORY };
    await store.write(settings.tagsFile, data);
    tagTree.refresh();
    vscode.window.showInformationMessage(`Tag created: ${tagName}`);
}

async function renameTag(
    settings: ArbeitsplatzSettings,
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

async function changeColor(settings: ArbeitsplatzSettings, tagTree: TagTreeProvider, item: TagTreeItem): Promise<void> {
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
    settings: ArbeitsplatzSettings,
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

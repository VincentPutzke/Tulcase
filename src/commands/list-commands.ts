import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { generateId } from '../utils/id';
import type { ArbeitsplatzSettings } from '../config';
import type { ListStore, MiniList, ListItem } from '../models/list.model';
import type { ListTreeProvider, ListParentItem, ListChildItem } from '../providers/list-tree.provider';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

export function registerListCommands(
    context: vscode.ExtensionContext,
    settings: ArbeitsplatzSettings,
    listTree: ListTreeProvider,
    tagTree: TagTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.list.add', () => addList(settings, listTree, tagTree)),
        vscode.commands.registerCommand('arbeitsplatz.list.addItem', (item: ListParentItem) => addItem(settings, listTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.list.toggleItem', (item: ListChildItem) => toggleItem(settings, listTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.list.edit', (item: ListParentItem) => editList(settings, listTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.list.editItem', (item: ListChildItem) => editItem(settings, listTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.list.delete', (item: ListParentItem) => deleteList(settings, listTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.list.deleteItem', (item: ListChildItem) => deleteItem(settings, listTree, item)),
    );
}

async function addList(settings: ArbeitsplatzSettings, listTree: ListTreeProvider, tagTree: TagTreeProvider): Promise<void> {
    const label = await vscode.window.showInputBox({ prompt: 'List name', placeHolder: 'Shopping' });
    if (!label) { return; }

    const description = await vscode.window.showInputBox({ prompt: 'Description (optional)', placeHolder: '' }) ?? '';

    const tagMap = await tagTree.getTagMap();
    const tagNames = Object.keys(tagMap);
    let tags: string[] = [];
    if (tagNames.length > 0) {
        const picked = await vscode.window.showQuickPick(
            tagNames.map(t => ({ label: t })),
            { canPickMany: true, placeHolder: 'Select tags (optional)' }
        );
        tags = picked?.map(p => p.label) ?? [];
    }

    const newList: MiniList = {
        id: generateId('ml'),
        label,
        description,
        tags,
        createdAt: new Date().toISOString().slice(0, 10),
        items: [],
    };

    const data = await store.read<ListStore>(settings.listsFile, { lists: [] });
    data.lists.push(newList);
    await store.write(settings.listsFile, data);
    listTree.refresh();
    vscode.window.showInformationMessage(`List created: ${label}`);
}

async function addItem(settings: ArbeitsplatzSettings, listTree: ListTreeProvider, parent: ListParentItem): Promise<void> {
    const text = await vscode.window.showInputBox({ prompt: 'Item text', placeHolder: 'New item' });
    if (!text) { return; }

    const newItem: ListItem = {
        id: generateId('li'),
        text,
        done: false,
        tags: [],
        createdAt: new Date().toISOString().slice(0, 10),
    };

    const data = await store.read<ListStore>(settings.listsFile, { lists: [] });
    const list = data.lists.find(l => l.id === parent.list.id);
    if (list) {
        list.items.push(newItem);
        await store.write(settings.listsFile, data);
        listTree.refresh();
    }
}

async function toggleItem(settings: ArbeitsplatzSettings, listTree: ListTreeProvider, item: ListChildItem): Promise<void> {
    const data = await store.read<ListStore>(settings.listsFile, { lists: [] });
    const list = data.lists.find(l => l.id === item.parentListId);
    if (list) {
        const listItem = list.items.find(i => i.id === item.item.id);
        if (listItem) {
            listItem.done = !listItem.done;
            await store.write(settings.listsFile, data);
            listTree.refresh();
        }
    }
}

async function editList(settings: ArbeitsplatzSettings, listTree: ListTreeProvider, item: ListParentItem): Promise<void> {
    const data = await store.read<ListStore>(settings.listsFile, { lists: [] });
    const list = data.lists.find(l => l.id === item.list.id);
    if (!list) { return; }

    const newLabel = await vscode.window.showInputBox({ prompt: 'List name', value: list.label });
    if (newLabel !== undefined) {
        list.label = newLabel;
        await store.write(settings.listsFile, data);
        listTree.refresh();
    }
}

async function editItem(settings: ArbeitsplatzSettings, listTree: ListTreeProvider, item: ListChildItem): Promise<void> {
    const data = await store.read<ListStore>(settings.listsFile, { lists: [] });
    const list = data.lists.find(l => l.id === item.parentListId);
    if (!list) { return; }

    const listItem = list.items.find(i => i.id === item.item.id);
    if (!listItem) { return; }

    const newText = await vscode.window.showInputBox({ prompt: 'Item text', value: listItem.text });
    if (newText !== undefined) {
        listItem.text = newText;
        await store.write(settings.listsFile, data);
        listTree.refresh();
    }
}

async function deleteList(settings: ArbeitsplatzSettings, listTree: ListTreeProvider, item: ListParentItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `Delete list "${item.list.label}" and all its items?`,
        { modal: true },
        'Delete'
    );
    if (confirm !== 'Delete') { return; }

    const data = await store.read<ListStore>(settings.listsFile, { lists: [] });
    data.lists = data.lists.filter(l => l.id !== item.list.id);
    await store.write(settings.listsFile, data);
    listTree.refresh();
}

async function deleteItem(settings: ArbeitsplatzSettings, listTree: ListTreeProvider, item: ListChildItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `Delete "${item.item.text}"?`,
        { modal: true },
        'Delete'
    );
    if (confirm !== 'Delete') { return; }

    const data = await store.read<ListStore>(settings.listsFile, { lists: [] });
    const list = data.lists.find(l => l.id === item.parentListId);
    if (list) {
        list.items = list.items.filter(i => i.id !== item.item.id);
        await store.write(settings.listsFile, data);
        listTree.refresh();
    }
}

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { removeNode, findNode } from '../data/link-tree';
import { generateId } from '../utils/id';
import type { ArbeitsplatzSettings } from '../config';
import type { LinkStore, LinkNode } from '../models/link.model';
import type { LinkTreeProvider, LinkTreeItem } from '../providers/link-tree.provider';

const store = new JsonStore();

export function registerLinkCommands(
    context: vscode.ExtensionContext,
    settings: ArbeitsplatzSettings,
    linkTree: LinkTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.link.addLink', (parent?: LinkTreeItem) => addLink(settings, linkTree, parent)),
        vscode.commands.registerCommand('arbeitsplatz.link.addFolder', (parent?: LinkTreeItem) => addFolder(settings, linkTree, parent)),
        vscode.commands.registerCommand('arbeitsplatz.link.open', (item: LinkTreeItem) => openLink(item)),
        vscode.commands.registerCommand('arbeitsplatz.link.copyUrl', (item: LinkTreeItem) => copyUrl(item)),
        vscode.commands.registerCommand('arbeitsplatz.link.edit', (item: LinkTreeItem) => editLink(settings, linkTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.link.delete', (item: LinkTreeItem) => deleteLink(settings, linkTree, item)),
    );
}

async function addLink(settings: ArbeitsplatzSettings, linkTree: LinkTreeProvider, parent?: LinkTreeItem): Promise<void> {
    const label = await vscode.window.showInputBox({ prompt: 'Link label', placeHolder: 'GitHub' });
    if (!label) { return; }

    const url = await vscode.window.showInputBox({ prompt: 'URL', placeHolder: 'https://github.com' });
    if (!url) { return; }

    const node: LinkNode = {
        id: generateId('ln'),
        type: 'link',
        label,
        url,
        createdAt: new Date().toISOString().slice(0, 10),
        tags: [],
    };

    const data = await store.read<LinkStore>(settings.linksFile, { root: [] });

    if (parent?.node.type === 'folder') {
        const folder = findNode(data.root, parent.node.id);
        if (folder) {
            if (!folder.children) { folder.children = []; }
            folder.children.push(node);
        }
    } else {
        data.root.push(node);
    }

    await store.write(settings.linksFile, data);
    linkTree.refresh();
    vscode.window.showInformationMessage(`Link added: ${label}`);
}

async function addFolder(settings: ArbeitsplatzSettings, linkTree: LinkTreeProvider, parent?: LinkTreeItem): Promise<void> {
    const label = await vscode.window.showInputBox({ prompt: 'Folder name', placeHolder: 'Dev Resources' });
    if (!label) { return; }

    const node: LinkNode = {
        id: generateId('ln'),
        type: 'folder',
        label,
        expanded: true,
        children: [],
    };

    const data = await store.read<LinkStore>(settings.linksFile, { root: [] });

    if (parent?.node.type === 'folder') {
        const folder = findNode(data.root, parent.node.id);
        if (folder) {
            if (!folder.children) { folder.children = []; }
            folder.children.push(node);
        }
    } else {
        data.root.push(node);
    }

    await store.write(settings.linksFile, data);
    linkTree.refresh();
    vscode.window.showInformationMessage(`Folder added: ${label}`);
}

async function openLink(item: LinkTreeItem): Promise<void> {
    if (item.node.url) {
        await vscode.env.openExternal(vscode.Uri.parse(item.node.url));
    }
}

async function copyUrl(item: LinkTreeItem): Promise<void> {
    if (item.node.url) {
        await vscode.env.clipboard.writeText(item.node.url);
        vscode.window.showInformationMessage(`Copied: ${item.node.url}`);
    }
}

async function editLink(settings: ArbeitsplatzSettings, linkTree: LinkTreeProvider, item: LinkTreeItem): Promise<void> {
    const data = await store.read<LinkStore>(settings.linksFile, { root: [] });
    const node = findNode(data.root, item.node.id);
    if (!node) { return; }

    if (node.type === 'link') {
        const field = await vscode.window.showQuickPick([
            { label: 'Label', description: node.label },
            { label: 'URL', description: node.url },
        ], { placeHolder: 'What to edit?' });

        if (field?.label === 'Label') {
            const newLabel = await vscode.window.showInputBox({ prompt: 'New label', value: node.label });
            if (newLabel !== undefined) { node.label = newLabel; }
        } else if (field?.label === 'URL') {
            const newUrl = await vscode.window.showInputBox({ prompt: 'New URL', value: node.url });
            if (newUrl !== undefined) { node.url = newUrl; }
        }
    } else {
        const newLabel = await vscode.window.showInputBox({ prompt: 'New folder name', value: node.label });
        if (newLabel !== undefined) { node.label = newLabel; }
    }

    await store.write(settings.linksFile, data);
    linkTree.refresh();
}

async function deleteLink(settings: ArbeitsplatzSettings, linkTree: LinkTreeProvider, item: LinkTreeItem): Promise<void> {
    const typeLabel = item.node.type === 'folder' ? 'folder' : 'link';
    const confirm = await vscode.window.showWarningMessage(
        `Delete ${typeLabel} "${item.node.label}"?`,
        { modal: true },
        'Delete'
    );
    if (confirm !== 'Delete') { return; }

    const data = await store.read<LinkStore>(settings.linksFile, { root: [] });
    removeNode(data.root, item.node.id);
    await store.write(settings.linksFile, data);
    linkTree.refresh();
}

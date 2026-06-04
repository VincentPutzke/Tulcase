/**
 * WebviewViewProvider for the Links panel.
 *
 * Renders a recursive folder/link tree in the same visual style as
 * TODOs, Commands, and Notes. Each link entry has a label, optional tags,
 * and exactly one URL. Clicking a link opens it in the default browser.
 *
 * The panel layout is **adaptive**:
 * - In a **sidebar** (narrow viewport): controls stacked above the tree.
 * - In a **bottom panel** (wide viewport): controls on the right, tree on
 *   the left, with the tree filling the remaining space.
 *
 * HTML lives in src/views/link-list.html.
 * Styles live in src/views/link-list.scss (compiled to out/link-list.css).
 */

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { findNode, moveNode, removeNode } from '../data/link-tree';
import { pickTags } from '../data/tag-picker';
import { generateId } from '../utils/id';
import type { LinkNode, LinkStore } from '../models/link.model';
import { BaseListViewProvider } from './base-list.view';

const store = new JsonStore();

export class LinkListViewProvider extends BaseListViewProvider {
    public static readonly viewType = 'tulcase.links';
    protected readonly viewName = 'link-list';
    protected override readonly sidebarMode = true;

    /** Public entry-point for the palette command `tulcase.link.add`. */
    addLinkFromPalette(): void {
        void this._addLink();
    }

    // ── Message handling ───────────────────────────────────────────────────────

    protected async _handleMessage(msg: { type: string; id?: string; targetId?: string; kind?: string }): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendData();
                break;
            case 'open':
                if (msg.id) { await this._openLink(msg.id); }
                break;
            case 'copyUrl':
                if (msg.id) { await this._copyUrl(msg.id); }
                break;
            case 'edit':
                if (msg.id) { await this._editLink(msg.id); }
                break;
            case 'delete':
                if (msg.id) { await this._deleteNode(msg.id); }
                break;
            case 'addLink':
                await this._addLink();
                break;
            case 'addLinkToFolder':
                if (msg.id) { await this._addLink(msg.id); }
                break;
            case 'addFolder':
                await this._addFolder();
                break;
            case 'addFolderToFolder':
                if (msg.id) { await this._addFolder(msg.id); }
                break;
            case 'renameFolder':
                if (msg.id) { await this._renameFolder(msg.id); }
                break;
            case 'deleteFolder':
                if (msg.id) { await this._deleteNode(msg.id); }
                break;
            case 'move':
                if (msg.id && msg.targetId !== undefined) { await this._moveNode(msg.id, msg.targetId); }
                break;
        }
    }

    // ── Data push ─────────────────────────────────────────────────────────────

    /** Load links + tags and push to the webview. */
    protected async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const data   = await this._readStore();
        const tagMap = await this.tagTree.getTagMap();

        this._view.webview.postMessage({
            type:  'updateData',
            root:  data.root,
            tagMap,
        });
    }

    // ── Link operations ───────────────────────────────────────────────────────

    /** Open a link in the default browser. */
    private async _openLink(id: string): Promise<void> {
        const data = await this._readStore();
        const node = findNode(data.root, id);
        if (node?.url) {
            await vscode.env.openExternal(vscode.Uri.parse(node.url));
        }
    }

    /** Copy a link's URL to clipboard. */
    private async _copyUrl(id: string): Promise<void> {
        const data = await this._readStore();
        const node = findNode(data.root, id);
        if (node?.url) {
            await vscode.env.clipboard.writeText(node.url);
            vscode.window.showInformationMessage(`Copied: ${node.url}`);
        }
    }

    /** Add a new link, optionally inside a folder. */
    private async _addLink(folderId?: string): Promise<void> {
        const label = await vscode.window.showInputBox({
            prompt: 'Link label',
            placeHolder: 'e.g. GitHub',
        });
        if (!label) { return; }

        const url = await vscode.window.showInputBox({
            prompt: 'URL',
            placeHolder: 'https://github.com',
        });
        if (!url) { return; }

        const tags = await pickTags(this.tagTree) ?? [];

        const node: LinkNode = {
            id: generateId('ln'),
            type: 'link',
            label,
            url,
            createdAt: new Date().toISOString().slice(0, 10),
            tags,
        };

        const data = await this._readStore();

        if (folderId) {
            const folder = findNode(data.root, folderId);
            if (folder && folder.type === 'folder') {
                if (!folder.children) { folder.children = []; }
                folder.children.push(node);
            }
        } else {
            data.root.push(node);
        }

        await store.write(this.settings.linksFile, data);
        await this._sendData();
    }

    /** Add a new folder, optionally inside another folder. */
    private async _addFolder(parentId?: string): Promise<void> {
        const label = await vscode.window.showInputBox({
            prompt: 'Folder name',
            placeHolder: 'e.g. Dev Resources',
        });
        if (!label) { return; }

        const node: LinkNode = {
            id: generateId('lf'),
            type: 'folder',
            label,
            expanded: true,
            children: [],
        };

        const data = await this._readStore();

        if (parentId) {
            const parent = findNode(data.root, parentId);
            if (parent && parent.type === 'folder') {
                if (!parent.children) { parent.children = []; }
                parent.children.push(node);
            }
        } else {
            data.root.push(node);
        }

        await store.write(this.settings.linksFile, data);
        await this._sendData();
    }

    /** Edit a link's label, URL, or tags — or a folder's name. */
    private async _editLink(id: string): Promise<void> {
        const data = await this._readStore();
        const node = findNode(data.root, id);
        if (!node) { return; }

        if (node.type === 'folder') {
            // Folders: just rename
            const name = await vscode.window.showInputBox({
                prompt: 'Folder name',
                value: node.label,
            });
            if (name !== undefined) { node.label = name; }
        } else {
            // Links: pick which field to edit
            const field = await vscode.window.showQuickPick([
                { label: 'Label', description: node.label },
                { label: 'URL',   description: node.url ?? '' },
                { label: 'Tags',  description: (node.tags ?? []).join(', ') || '(none)' },
            ], { placeHolder: 'Edit link property' });

            if (!field) { return; }

            if (field.label === 'Label') {
                const v = await vscode.window.showInputBox({ prompt: 'Link label', value: node.label });
                if (v !== undefined) { node.label = v; }
            } else if (field.label === 'URL') {
                const v = await vscode.window.showInputBox({ prompt: 'URL', value: node.url });
                if (v !== undefined) { node.url = v; }
            } else if (field.label === 'Tags') {
                const picked = await pickTags(this.tagTree, node.tags ?? []);
                if (picked) { node.tags = picked; }
            }
        }

        await store.write(this.settings.linksFile, data);
        await this._sendData();
    }

    /** Rename a folder. */
    private async _renameFolder(id: string): Promise<void> {
        const data = await this._readStore();
        const node = findNode(data.root, id);
        if (!node || node.type !== 'folder') { return; }

        const name = await vscode.window.showInputBox({
            prompt: 'Folder name',
            value: node.label,
        });
        if (name === undefined) { return; }
        node.label = name;

        await store.write(this.settings.linksFile, data);
        await this._sendData();
    }

    /** Delete a link or folder (with confirmation). */
    private async _deleteNode(id: string): Promise<void> {
        const data = await this._readStore();
        const node = findNode(data.root, id);
        if (!node) { return; }

        const typeLabel = node.type === 'folder' ? 'folder' : 'link';
        const confirm = await vscode.window.showWarningMessage(
            `Delete ${typeLabel} "${node.label}"?`,
            { modal: true },
            'Delete',
        );
        if (confirm !== 'Delete') { return; }

        removeNode(data.root, id);
        await store.write(this.settings.linksFile, data);
        await this._sendData();
    }

    private async _moveNode(id: string, targetId: string): Promise<void> {
        const data = await this._readStore();
        if (!moveNode(data.root, id, targetId)) { return; }

        await store.write(this.settings.linksFile, data);
        await this._sendData();
    }

    // ── Data access ───────────────────────────────────────────────────────────

    /** Read the link store from disk. */
    private async _readStore(): Promise<LinkStore> {
        return store.read<LinkStore>(this.settings.linksFile, { root: [] });
    }
}

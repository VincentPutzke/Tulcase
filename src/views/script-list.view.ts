/**
 * WebviewViewProvider for the Scripts sidebar panel.
 *
 * Renders a folder/script tree in the same visual style as Commands and Notes.
 * Clicking a script opens its backing `.sh` file in the main editor via the
 * `tulcase-script:` filesystem; the ▶ action runs it in the terminal.
 *
 * HTML lives in src/views/script-list.html.
 * Styles live in src/views/script-list.scss (compiled to out/script-list.css).
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { moveFlatFolder, moveFlatItem } from '../data/flat-folder-tree';
import { JsonStore } from '../data/json-store';
import { ScriptFileSystemProvider } from '../data/script-fs';
import { runScriptInTerminal } from '../data/script-runner';
import { pickTags } from '../data/tag-picker';
import { generateId } from '../utils/id';
import { parsePlaceholders } from '../utils/placeholder';
import type {
    ScriptItem,
    ScriptFolder,
    ScriptStore,
} from '../models/script.model';
import type { PlaceholderDef } from '../models/command.model';
import { BaseListViewProvider } from './base-list.view';

const store = new JsonStore();

/** Starter body written into a new script's .sh file. */
function starterScript(label: string): string {
    return [
        '#!/usr/bin/env bash',
        '#',
        `# ${label}`,
        '#',
        '# Tip: add a line "# tulcase: no-confirm" to skip the run confirmation.',
        '# Use <$name$> anywhere for placeholders — you are prompted for them on run.',
        '',
        'set -euo pipefail',
        '',
        '',
    ].join('\n');
}

export class ScriptListViewProvider extends BaseListViewProvider {
    public static readonly viewType = 'tulcase.scripts';
    protected readonly viewName = 'script-list';
    protected override readonly sidebarMode = true;

    // ── Public palette entry-points ───────────────────────────────────────────

    /** Open the guided add-script dialog from the command palette / title button. */
    public addScriptFromPalette(): void {
        void this._handleMessage({ type: 'addScript' });
    }

    // ── Message handling ───────────────────────────────────────────────────────

    protected async _handleMessage(msg: { type: string; id?: string; targetId?: string; kind?: string }): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendData();
                break;
            case 'open':
                if (msg.id) { await this._openScript(msg.id); }
                break;
            case 'run':
                if (msg.id) { await this._runScript(msg.id); }
                break;
            case 'editMeta':
                if (msg.id) { await this._editScriptMeta(msg.id); }
                break;
            case 'delete':
                if (msg.id) { await this._deleteScript(msg.id); }
                break;
            case 'addScript':
                await this._addScript();
                break;
            case 'addScriptToFolder':
                if (msg.id) { await this._addScript(msg.id); }
                break;
            case 'addFolder':
                await this._addFolder();
                break;
            case 'addSubFolder':
                if (msg.id) { await this._addFolder(msg.id); }
                break;
            case 'renameFolder':
                if (msg.id) { await this._renameFolder(msg.id); }
                break;
            case 'deleteFolder':
                if (msg.id) { await this._deleteFolder(msg.id); }
                break;
            case 'move':
                if (msg.id && msg.kind && msg.targetId !== undefined) {
                    await this._moveEntry(msg.id, msg.kind, msg.targetId);
                }
                break;
        }
    }

    // ── Data push ─────────────────────────────────────────────────────────────

    /** Load scripts + folders + tags (and parsed placeholder names) and push. */
    protected async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const data   = await this._readStore();
        const tagMap = await this.tagTree.getTagMap();

        // Enrich each script with the placeholder names parsed from its body so
        // the tree can show a badge without the webview needing file access.
        const scripts = await Promise.all(data.items.map(async item => ({
            ...item,
            placeholderNames: parsePlaceholders(await this._readContent(item.id)),
        })));

        this._view.webview.postMessage({
            type:    'updateData',
            scripts,
            folders: data.folders,
            tagMap,
        });
    }

    // ── Script operations ───────────────────────────────────────────────────

    /** Open a script's .sh file in the main editor area. */
    private async _openScript(id: string): Promise<void> {
        const data = await this._readStore();
        const item = data.items.find(s => s.id === id);
        if (!item) { return; }

        const uri = ScriptFileSystemProvider.uri(item);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
        await vscode.languages.setTextDocumentLanguage(doc, 'shellscript');
    }

    private async _runScript(id: string): Promise<void> {
        const data = await this._readStore();
        const item = data.items.find(s => s.id === id);
        if (!item) { return; }
        await runScriptInTerminal(this.settings, item);
    }

    private async _addScript(folderId?: string): Promise<void> {
        const label = await vscode.window.showInputBox({
            prompt: 'Script name',
            placeHolder: 'e.g. Deploy to staging',
        });
        if (!label) { return; }

        const description = await vscode.window.showInputBox({
            prompt: 'Short description (optional)',
            placeHolder: 'e.g. Builds and uploads the staging bundle',
        });
        if (description === undefined) { return; } // cancelled

        const tags = await pickTags(this.tagTree) ?? [];

        const data = await this._readStore();
        let folder = folderId ?? '';
        if (!folderId) {
            const picked = await this._pickFolder(data, '');
            if (picked === undefined) { return; }
            folder = picked;
        }

        const now = new Date().toISOString().slice(0, 10);
        const item: ScriptItem = {
            id: generateId('sc'),
            label,
            description: description || undefined,
            tags,
            folder,
            createdAt: now,
            updatedAt: now,
        };

        // Create the backing .sh file with a starter template.
        await this._writeContent(item.id, starterScript(label));

        data.items.push(item);
        await store.write(this.settings.scriptsFile, data);
        await this._sendData();

        // Open the new script for editing immediately.
        await this._openScript(item.id);
        vscode.window.showInformationMessage(`Script added: ${label}`);
    }

    private async _editScriptMeta(id: string): Promise<void> {
        const data = await this._readStore();
        const item = data.items.find(s => s.id === id);
        if (!item) { return; }

        const names = parsePlaceholders(await this._readContent(id));

        const picks: vscode.QuickPickItem[] = [
            { label: 'Name',        description: item.label },
            { label: 'Description', description: item.description || '(none)' },
            { label: 'Tags',        description: item.tags.join(', ') || '(none)' },
            { label: 'Folder',      description: this._folderName(data, item.folder) || '(root)' },
        ];
        if (names.length > 0) {
            picks.push({ label: 'Placeholders', description: names.map(n => `<$${n}$>`).join(', ') });
        }
        picks.push({ label: 'Delete', description: 'Remove this script' });

        const field = await vscode.window.showQuickPick(picks, { placeHolder: 'Edit script' });
        if (!field) { return; }

        if (field.label === 'Name') {
            const v = await vscode.window.showInputBox({ prompt: 'Script name', value: item.label });
            if (v !== undefined && v.trim()) { item.label = v.trim(); }
        } else if (field.label === 'Description') {
            const v = await vscode.window.showInputBox({ prompt: 'Description', value: item.description ?? '' });
            if (v !== undefined) { item.description = v.trim() || undefined; }
        } else if (field.label === 'Tags') {
            const picked = await pickTags(this.tagTree, item.tags);
            if (picked) { item.tags = picked; }
        } else if (field.label === 'Folder') {
            const folder = await this._pickFolder(data, item.folder);
            if (folder !== undefined) { item.folder = folder; }
        } else if (field.label === 'Placeholders') {
            const placeholders = item.placeholders ?? {};
            for (const name of names) {
                const current = placeholders[name]?.defaults ?? [];
                const input = await vscode.window.showInputBox({
                    prompt: `Default values for <$${name}$> (comma-separated, leave empty for free text)`,
                    value: current.join(', '),
                    placeHolder: 'e.g. staging, production',
                });
                if (input === undefined) { return; } // cancelled
                placeholders[name] = {
                    defaults: input ? input.split(',').map(s => s.trim()).filter(Boolean) : [],
                };
            }
            // Keep only placeholders that still appear in the body.
            const active: Record<string, PlaceholderDef> = {};
            for (const name of names) { if (placeholders[name]) { active[name] = placeholders[name]; } }
            item.placeholders = Object.keys(active).length > 0 ? active : undefined;
        } else if (field.label === 'Delete') {
            await this._deleteScript(id);
            return;
        }

        item.updatedAt = new Date().toISOString().slice(0, 10);
        await store.write(this.settings.scriptsFile, data);
        await this._sendData();
    }

    private async _deleteScript(id: string): Promise<void> {
        const data = await this._readStore();
        const item = data.items.find(s => s.id === id);
        if (!item) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `Delete script "${item.label}"? This also deletes its .sh file.`,
            { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }

        data.items = data.items.filter(s => s.id !== id);
        await store.write(this.settings.scriptsFile, data);
        await this._deleteContent(id);
        await this._sendData();
    }

    // ── Folder operations ─────────────────────────────────────────────────────

    private async _addFolder(parentId?: string): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Folder name',
            placeHolder: 'e.g. Deployment',
        });
        if (!name) { return; }

        const data = await this._readStore();
        let parent = parentId ?? '';
        if (!parentId && data.folders.length > 0) {
            const choice = await this._pickParentFolder(data);
            if (choice === undefined) { return; }
            parent = choice;
        }

        data.folders.push({ id: generateId('sf'), name, parent });
        await store.write(this.settings.scriptsFile, data);
        await this._sendData();
    }

    private async _renameFolder(id: string): Promise<void> {
        const data = await this._readStore();
        const folder = data.folders.find(f => f.id === id);
        if (!folder) { return; }

        const name = await vscode.window.showInputBox({ prompt: 'Folder name', value: folder.name });
        if (name === undefined) { return; }

        folder.name = name;
        await store.write(this.settings.scriptsFile, data);
        await this._sendData();
    }

    private async _deleteFolder(id: string): Promise<void> {
        const data = await this._readStore();
        const folder = data.folders.find(f => f.id === id);
        if (!folder) { return; }

        const scriptsInFolder = data.items.filter(s => s.folder === id);
        const subFolders = data.folders.filter(f => f.parent === id);
        const total = scriptsInFolder.length + subFolders.length;

        const message = total > 0
            ? `Delete folder "${folder.name}" and move its ${total} item(s) to root?`
            : `Delete empty folder "${folder.name}"?`;

        const confirm = await vscode.window.showWarningMessage(message, { modal: true }, 'Delete');
        if (confirm !== 'Delete') { return; }

        for (const s of scriptsInFolder) { s.folder = folder.parent; }
        for (const f of subFolders)      { f.parent = folder.parent; }

        data.folders = data.folders.filter(f => f.id !== id);
        await store.write(this.settings.scriptsFile, data);
        await this._sendData();
    }

    private async _moveEntry(id: string, kind: string, targetId: string): Promise<void> {
        const data = await this._readStore();

        const moved = kind === 'folder'
            ? moveFlatFolder(data.folders, id, targetId)
            : moveFlatItem(data.items, data.folders, id, targetId);

        if (!moved) { return; }

        if (kind !== 'folder') {
            const item = data.items.find(s => s.id === id);
            if (item) { item.updatedAt = new Date().toISOString().slice(0, 10); }
        }

        await store.write(this.settings.scriptsFile, data);
        await this._sendData();
    }

    // ── Folder picker helpers ─────────────────────────────────────────────────

    private _folderName(data: ScriptStore, folderId: string): string {
        if (!folderId) { return ''; }
        return data.folders.find(f => f.id === folderId)?.name ?? '';
    }

    private async _pickFolder(data: ScriptStore, currentFolderId: string): Promise<string | undefined> {
        const currentName = this._folderName(data, currentFolderId) || '(root)';
        const picks: vscode.QuickPickItem[] = [
            { label: '(root)', description: 'No folder' },
            ...data.folders.map(f => ({ label: f.name, description: f.id })),
            { label: '+ New folder...', description: 'Create a new folder' },
        ];

        const choice = await vscode.window.showQuickPick(picks, {
            placeHolder: `Current: ${currentName} — Choose folder`,
        });
        if (!choice) { return undefined; }
        if (choice.label === '(root)') { return ''; }
        if (choice.label === '+ New folder...') {
            const name = await vscode.window.showInputBox({ prompt: 'New folder name', placeHolder: 'e.g. Deployment' });
            if (!name) { return undefined; }
            const newFolder: ScriptFolder = { id: generateId('sf'), name, parent: '' };
            data.folders.push(newFolder);
            return newFolder.id;
        }
        return choice.description ?? '';
    }

    private async _pickParentFolder(data: ScriptStore): Promise<string | undefined> {
        const picks: vscode.QuickPickItem[] = [
            { label: '(root)', description: 'Top level' },
            ...data.folders.map(f => ({ label: f.name, description: f.id })),
        ];
        const choice = await vscode.window.showQuickPick(picks, { placeHolder: 'Place folder inside...' });
        if (!choice) { return undefined; }
        if (choice.label === '(root)') { return ''; }
        return choice.description ?? '';
    }

    // ── Disk + store helpers ──────────────────────────────────────────────────

    private async _readContent(id: string): Promise<string> {
        try {
            return await fs.readFile(ScriptFileSystemProvider.diskPath(this.settings, id), 'utf-8');
        } catch {
            return '';
        }
    }

    private async _writeContent(id: string, content: string): Promise<void> {
        const filePath = ScriptFileSystemProvider.diskPath(this.settings, id);
        await fs.mkdir(this.settings.scriptsDir, { recursive: true });
        await fs.writeFile(filePath, content, 'utf-8');
    }

    private async _deleteContent(id: string): Promise<void> {
        try {
            await fs.unlink(ScriptFileSystemProvider.diskPath(this.settings, id));
        } catch {
            // File may not exist — ignore.
        }
    }

    private async _readStore(): Promise<ScriptStore> {
        const raw = await store.read<Record<string, unknown>>(
            this.settings.scriptsFile,
            { items: [], folders: [] },
        );
        const items = Array.isArray(raw.items) ? (raw.items as ScriptItem[]) : [];
        const folders = Array.isArray(raw.folders) ? (raw.folders as ScriptFolder[]) : [];
        return { items, folders };
    }
}

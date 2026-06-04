import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { pickTags } from '../data/tag-picker';
import { moveFlatFolder, moveFlatItem } from '../data/flat-folder-tree';
import { generateId } from '../utils/id';
import {
    parsePlaceholders,
    prunePlaceholders,
} from '../utils/placeholder';
import { resolveCommand } from '../utils/placeholder-resolve';
import type {
    CommandItem,
    CommandFolder,
    CommandStore,
    LegacyCommandStore,
    LegacyCommandEntry,
    PlaceholderDef,
} from '../models/command.model';
import { BaseListViewProvider } from './base-list.view';

const store = new JsonStore();

export class CommandListViewProvider extends BaseListViewProvider {
    public static readonly viewType = 'tulcase.commands';
    protected readonly viewName = 'command-list';
    protected override readonly sidebarMode = true;

    // ── Public palette entry-points ───────────────────────────────────────────

    /** Open the guided add-command dialog from the command palette. */
    public addCommandFromPalette(): void {
        void this._handleMessage({ type: 'addCommand' });
    }

    // ── Message handling ───────────────────────────────────────────────────────

    protected async _handleMessage(msg: { type: string; id?: string; targetId?: string; kind?: string }): Promise<void> {
        switch (msg.type) {
            case 'requestData':
                await this._sendData();
                break;
            case 'copy':
                if (msg.id) { await this._copyCommand(msg.id); }
                break;
            case 'runInTerminal':
                if (msg.id) { await this._runInTerminal(msg.id); }
                break;
            case 'edit':
                if (msg.id) { await this._editCommand(msg.id); }
                break;
            case 'delete':
                if (msg.id) { await this._deleteCommand(msg.id); }
                break;
            case 'addCommand':
                await this._addCommand();
                break;
            case 'addFolder':
                await this._addFolder();
                break;
            case 'addSubFolder':
                if (msg.id) { await this._addFolder(msg.id); }
                break;
            case 'addCommandToFolder':
                if (msg.id) { await this._addCommand(msg.id); }
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

    /** Load commands + tag map and push to the webview. */
    protected async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const data   = await this._readstore();
        const tagMap = await this.tagTree.getTagMap();

        this._view.webview.postMessage({
            type:     'updateData',
            commands: data.items,
            folders:  data.folders ?? [],
            tagMap,
        });
    }

    // ── Data operations ───────────────────────────────────────────────────────

    private async _copyCommand(id: string): Promise<void> {
        const data = await this._readstore();
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        const resolved = await resolveCommand(item);
        if (resolved === undefined) { return; }

        await vscode.env.clipboard.writeText(resolved);
        vscode.window.showInformationMessage(`Copied: ${item.label}`);
    }

    private async _runInTerminal(id: string): Promise<void> {
        const data = await this._readstore();
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        const resolved = await resolveCommand(item);
        if (resolved === undefined) { return; }

        let terminal = vscode.window.activeTerminal;
        if (!terminal) {
            terminal = vscode.window.createTerminal('Tulcase');
        }
        terminal.show();
        terminal.sendText(resolved);
    }

    private async _editCommand(id: string): Promise<void> {
        const data = await this._readstore();
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        const hasPlaceholders = parsePlaceholders(item.command).length > 0;

        const picks: vscode.QuickPickItem[] = [
            { label: 'Label',   description: item.label },
            { label: 'Command', description: item.command.substring(0, 60) },
            { label: 'Tags',    description: item.tags.join(', ') },
            { label: 'Folder',  description: this._folderName(data, item.folder) || '(root)' },
        ];

        // Only show "Placeholders" when the command contains placeholder tokens
        if (hasPlaceholders) {
            const names = parsePlaceholders(item.command);
            picks.push({
                label: 'Placeholders',
                description: names.map(n => `<$${n}$>`).join(', '),
            });
        }

        picks.push({ label: 'Delete', description: 'Remove this command' });

        const field = await vscode.window.showQuickPick(picks, {
            placeHolder: 'What to edit?',
        });

        if (!field) { return; }

        if (field.label === 'Label') {
            const v = await vscode.window.showInputBox({
                prompt: 'New label',
                value: item.label,
            });
            if (v !== undefined) { item.label = v; }
        } else if (field.label === 'Command') {
            const v = await vscode.window.showInputBox({
                prompt: 'New command text',
                value: item.command,
            });
            if (v !== undefined) {
                item.command = v;
                // Prune stale placeholder keys after command text change
                item.placeholders = prunePlaceholders(v, item.placeholders);
            }
        } else if (field.label === 'Tags') {
            const picked = await pickTags(this.tagTree, item.tags);
            if (picked) { item.tags = picked; }
        } else if (field.label === 'Folder') {
            const folderPick = await this._pickFolderById(data, item.folder);
            if (folderPick !== undefined) { item.folder = folderPick; }
        } else if (field.label === 'Placeholders') {
            const names = parsePlaceholders(item.command);
            const placeholders = item.placeholders ?? {};

            for (const name of names) {
                const current = placeholders[name]?.defaults ?? [];
                const input = await vscode.window.showInputBox({
                    prompt: `Default values for <$${name}$> (comma-separated, leave empty for free text)`,
                    value: current.join(', '),
                    placeHolder: 'e.g. main, develop, feature/*',
                });
                if (input === undefined) { return; } // cancelled
                const defaults = input
                    ? input.split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                placeholders[name] = { defaults };
            }

            item.placeholders = Object.keys(placeholders).length > 0
                ? placeholders
                : undefined;
        } else if (field.label === 'Delete') {
            const confirm = await vscode.window.showWarningMessage(
                `Delete "${item.label}"?`, { modal: true }, 'Delete',
            );
            if (confirm === 'Delete') {
                data.items = data.items.filter(i => i.id !== id);
            }
        }

        await store.write(this.settings.commandsFile, data);
        await this._sendData();
    }

    private async _deleteCommand(id: string): Promise<void> {
        const data = await this._readstore();
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `Delete "${item.label}"?`, { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }

        data.items = data.items.filter(i => i.id !== id);
        await store.write(this.settings.commandsFile, data);
        await this._sendData();
    }

    private async _addCommand(folderId?: string): Promise<void> {
        const label = await vscode.window.showInputBox({
            prompt: 'Command label',
            placeHolder: 'e.g. Git Submodule Init',
        });
        if (!label) { return; }

        const command = await vscode.window.showInputBox({
            prompt: 'Command text (shell command) — use <$name$> for placeholders',
            placeHolder: 'git checkout <$branch$> && npm install',
        });
        if (command === undefined) { return; }

        // ── Placeholder defaults ───────────────────────────────────────────
        const names = parsePlaceholders(command);
        let placeholders: Record<string, PlaceholderDef> | undefined;

        if (names.length > 0) {
            const map: Record<string, PlaceholderDef> = {};

            for (const name of names) {
                const input = await vscode.window.showInputBox({
                    prompt: `Default values for <$${name}$> (comma-separated, leave empty for free text)`,
                    placeHolder: 'e.g. main, develop, feature/*',
                });
                if (input === undefined) { return; } // cancelled
                const defaults = input
                    ? input.split(',').map(s => s.trim()).filter(Boolean)
                    : [];
                map[name] = { defaults };
            }

            placeholders = Object.keys(map).length > 0 ? map : undefined;
        }

        // ── Tags & folder ──────────────────────────────────────────────────
        const tags = await pickTags(this.tagTree) ?? [];

        const data = await this._readstore();
        let folder = folderId ?? '';
        if (!folderId) {
            const picked = await this._pickFolderById(data, '');
            if (picked === undefined) { return; }
            folder = picked;
        }

        const item: CommandItem = {
            id: generateId('cmd'),
            label,
            command,
            tags,
            folder,
        };

        if (placeholders) { item.placeholders = placeholders; }

        data.items.push(item);

        await store.write(this.settings.commandsFile, data);
        await this._sendData();
        vscode.window.showInformationMessage(`Command added: ${label}`);
    }

    /** Create a new folder, optionally inside another folder. */
    private async _addFolder(parentId?: string): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'New folder name',
            placeHolder: 'e.g. DevOps',
        });
        if (!name) { return; }

        const data = await this._readstore();
        if (!data.folders) { data.folders = []; }

        let parent = parentId ?? '';
        if (!parentId && data.folders.length > 0) {
            const choice = await this._pickParentFolder(data);
            if (choice === undefined) { return; }
            parent = choice;
        }

        data.folders.push({
            id: generateId('cf'),
            name,
            parent,
        });

        await store.write(this.settings.commandsFile, data);
        await this._sendData();
    }

    /** Rename a folder. */
    private async _renameFolder(id: string): Promise<void> {
        const data = await this._readstore();
        const folder = (data.folders ?? []).find(f => f.id === id);
        if (!folder) { return; }

        const name = await vscode.window.showInputBox({
            prompt: 'Folder name',
            value: folder.name,
        });
        if (name === undefined) { return; }

        folder.name = name;
        await store.write(this.settings.commandsFile, data);
        await this._sendData();
    }

    /** Delete a folder (move children to root). */
    private async _deleteFolder(id: string): Promise<void> {
        const data = await this._readstore();
        const folders = data.folders ?? [];
        const folder = folders.find(f => f.id === id);
        if (!folder) { return; }

        const cmdsInFolder = data.items.filter(i => i.folder === id);
        const subFolders = folders.filter(f => f.parent === id);
        const total = cmdsInFolder.length + subFolders.length;

        const message = total > 0
            ? `Delete folder "${folder.name}" and move its ${total} item(s) to root?`
            : `Delete empty folder "${folder.name}"?`;

        const confirm = await vscode.window.showWarningMessage(
            message, { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }

        for (const c of cmdsInFolder) { c.folder = folder.parent; }
        for (const f of subFolders)   { f.parent = folder.parent; }

        data.folders = folders.filter(f => f.id !== id);
        await store.write(this.settings.commandsFile, data);
        await this._sendData();
    }

    private async _moveEntry(id: string, kind: string, targetId: string): Promise<void> {
        const data = await this._readstore();
        const folders = data.folders ?? [];

        const moved = kind === 'folder'
            ? moveFlatFolder(folders, id, targetId)
            : moveFlatItem(data.items, folders, id, targetId);

        if (!moved) { return; }

        data.folders = folders;
        await store.write(this.settings.commandsFile, data);
        await this._sendData();
    }

    // ── Folder helpers ────────────────────────────────────────────────────────

    /** Get a human-readable name for a folder ID. */
    private _folderName(data: CommandStore, folderId: string): string {
        if (!folderId) { return ''; }
        return (data.folders ?? []).find(f => f.id === folderId)?.name ?? folderId;
    }

    /** QuickPick to move a command into an existing folder, root, or new folder. */
    private async _pickFolderById(
        data: CommandStore,
        currentFolderId: string,
    ): Promise<string | undefined> {
        const currentName = this._folderName(data, currentFolderId) || '(root)';
        const folders = data.folders ?? [];

        const picks: vscode.QuickPickItem[] = [
            { label: '(root)', description: 'No folder' },
            ...folders.map(f => ({
                label: f.name,
                description: f.id,
            })),
            { label: '+ New folder...', description: 'Create a new folder' },
        ];

        const choice = await vscode.window.showQuickPick(picks, {
            placeHolder: `Current: ${currentName} — Choose folder`,
        });

        if (!choice) { return undefined; }
        if (choice.label === '(root)') { return ''; }

        if (choice.label === '+ New folder...') {
            const name = await vscode.window.showInputBox({
                prompt: 'New folder name',
                placeHolder: 'e.g. DevOps',
            });
            if (!name) { return undefined; }

            const newFolder: CommandFolder = {
                id: generateId('cf'),
                name,
                parent: '',
            };
            if (!data.folders) { data.folders = []; }
            data.folders.push(newFolder);
            return newFolder.id;
        }

        return choice.description ?? '';
    }

    /** QuickPick to choose a parent folder (for sub-folder creation). */
    private async _pickParentFolder(data: CommandStore): Promise<string | undefined> {
        const folders = data.folders ?? [];
        const picks: vscode.QuickPickItem[] = [
            { label: '(root)', description: 'Top level' },
            ...folders.map(f => ({
                label: f.name,
                description: f.id,
            })),
        ];

        const choice = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Place folder inside...',
        });

        if (!choice) { return undefined; }
        if (choice.label === '(root)') { return ''; }
        return choice.description ?? '';
    }

    // ── Data access with migration ────────────────────────────────────────────

    /**
     * Read the command store, migrating from the legacy Record<string,…> format
     * to the new items-array format if necessary.
     */
    private async _readstore(): Promise<CommandStore> {
        // Try to parse as the new format first
        const raw = await store.read<Record<string, unknown>>(
            this.settings.commandsFile,
            { items: [] },
        );

        // New format: has `items` array at root
        if (Array.isArray(raw.items)) {
            const data = raw as unknown as CommandStore;
            // Migrate flat folder names → folder IDs (v2 → v3)
            if (this._migrateFlatFolders(data)) {
                await store.write(this.settings.commandsFile, data);
            }
            return data;
        }

        // Legacy format: has `commands` object at root
        if (raw.commands && typeof raw.commands === 'object' && !Array.isArray(raw.commands)) {
            const migrated = this._migrateLegacy(raw as unknown as LegacyCommandStore);
            await store.write(this.settings.commandsFile, migrated);
            return migrated;
        }

        // Fallback: empty store
        return { items: [], folders: [] };
    }

    /**
     * Migrate items that use folder name strings to folder ID references.
     * Creates folder entries and rewrites item.folder to the new ID.
     * @returns true if any migration was performed.
     */
    private _migrateFlatFolders(data: CommandStore): boolean {
        // Skip if folders array already exists
        if (data.folders && data.folders.length > 0) { return false; }

        // Collect unique folder names from items
        const names = new Set<string>();
        for (const item of data.items) {
            if (item.folder && item.folder.length > 0) {
                names.add(item.folder);
            }
        }

        if (names.size === 0) { return false; }

        // Create folder entries
        const folders: CommandFolder[] = [];
        const nameToId = new Map<string, string>();

        for (const name of names) {
            const id = generateId('cf');
            nameToId.set(name, id);
            folders.push({ id, name, parent: '' });
        }

        // Rewrite item folder references from names to IDs
        for (const item of data.items) {
            if (item.folder && nameToId.has(item.folder)) {
                item.folder = nameToId.get(item.folder)!;
            }
        }

        data.folders = folders;
        return true;
    }

    /** Convert legacy Record<string, CommandEntry | string> to items array. */
    private _migrateLegacy(legacy: LegacyCommandStore): CommandStore {
        const items: CommandItem[] = [];

        for (const [label, entry] of Object.entries(legacy.commands)) {
            if (typeof entry === 'string') {
                // Very old format: plain string command
                items.push({
                    id: generateId('cmd'),
                    label,
                    command: entry,
                    tags: [],
                    folder: '',
                });
            } else {
                const e = entry as LegacyCommandEntry;
                items.push({
                    id: generateId('cmd'),
                    label,
                    command: e.command,
                    tags: e.tags ?? [],
                    folder: '',
                });
            }
        }

        return { items };
    }
}

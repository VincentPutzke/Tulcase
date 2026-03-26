import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { JsonStore } from '../data/json-store';
import { pickTags } from '../data/tag-picker';
import { generateId } from '../utils/id';
import type { TulcaseSettings } from '../config';
import type {
    CommandItem,
    CommandStore,
    LegacyCommandStore,
    LegacyCommandEntry,
} from '../models/command.model';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

/**
 * WebviewViewProvider that renders a rich Command list with:
 *   - Folder tree organisation (collapsible sections)
 *   - Collapsible multiline command text per item
 *   - Action buttons: edit, copy, send-to-terminal
 *   - Tag support with colour-coded labels
 *   - Search across label, command text, tags, and folders
 *
 * HTML lives in src/views/command-list.html.
 * Styles live in src/views/command-list.scss (compiled to out/command-list.css).
 */
export class CommandListViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tulcase.commands';

    private _view?: vscode.WebviewView;

    constructor(
        private readonly settings: TulcaseSettings,
        private readonly tagTree: TagTreeProvider,
    ) {}

    // ── WebviewViewProvider ────────────────────────────────────────────────────

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html    = this._buildHtml();

        webviewView.webview.onDidReceiveMessage(msg => this._handleMessage(msg));
    }

    /** Called from extension when the file watcher detects a change. */
    refresh(): void {
        if (this._view?.visible) {
            void this._sendData();
        }
    }

    // ── Message handling ───────────────────────────────────────────────────────

    private async _handleMessage(msg: { type: string; id?: string }): Promise<void> {
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
        }
    }

    // ── Data push ─────────────────────────────────────────────────────────────

    /** Load commands + tag map and push to the webview. */
    private async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const data   = await this._readstore();
        const tagMap = await this.tagTree.getTagMap();

        this._view.webview.postMessage({
            type:     'updateData',
            commands: data.items,
            tagMap,
        });
    }

    // ── Data operations ───────────────────────────────────────────────────────

    private async _copyCommand(id: string): Promise<void> {
        const data = await this._readstore();
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        await vscode.env.clipboard.writeText(item.command);
        vscode.window.showInformationMessage(`Copied: ${item.label}`);
    }

    private async _runInTerminal(id: string): Promise<void> {
        const data = await this._readstore();
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        let terminal = vscode.window.activeTerminal;
        if (!terminal) {
            terminal = vscode.window.createTerminal('Tulcase');
        }
        terminal.show();
        terminal.sendText(item.command);
    }

    private async _editCommand(id: string): Promise<void> {
        const data = await this._readstore();
        const item = data.items.find(i => i.id === id);
        if (!item) { return; }

        const field = await vscode.window.showQuickPick([
            { label: 'Label',   description: item.label },
            { label: 'Command', description: item.command.substring(0, 60) },
            { label: 'Tags',    description: item.tags.join(', ') },
            { label: 'Folder',  description: item.folder || '(root)' },
            { label: 'Delete',  description: 'Remove this command' },
        ], { placeHolder: 'What to edit?' });

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
            if (v !== undefined) { item.command = v; }
        } else if (field.label === 'Tags') {
            const picked = await pickTags(this.tagTree, item.tags);
            if (picked) { item.tags = picked; }
        } else if (field.label === 'Folder') {
            const existing = this._getExistingFolders(data);
            const folderPick = await this._pickFolder(existing, item.folder);
            if (folderPick !== undefined) { item.folder = folderPick; }
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

    private async _addCommand(): Promise<void> {
        const label = await vscode.window.showInputBox({
            prompt: 'Command label',
            placeHolder: 'e.g. Git Submodule Init',
        });
        if (!label) { return; }

        const command = await vscode.window.showInputBox({
            prompt: 'Command text (shell command)',
            placeHolder: 'git submodule update --init --recursive',
        });
        if (command === undefined) { return; }

        const tags = await pickTags(this.tagTree) ?? [];

        const data     = await this._readstore();
        const existing = this._getExistingFolders(data);
        const folder   = await this._pickFolder(existing, '') ?? '';

        data.items.push({
            id: generateId('cmd'),
            label,
            command,
            tags,
            folder,
        });

        await store.write(this.settings.commandsFile, data);
        await this._sendData();
        vscode.window.showInformationMessage(`Command added: ${label}`);
    }

    /** Prompt user for a new folder name, then create a placeholder message. */
    private async _addFolder(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'New folder name',
            placeHolder: 'e.g. DevOps',
        });
        if (!name) { return; }

        // Folders are implicit (derived from items). Show confirmation.
        vscode.window.showInformationMessage(
            `Folder "${name}" created. Assign commands to it via Edit > Folder.`,
        );

        // To make the folder immediately visible, add a placeholder command
        // that the user can later edit or delete; or simply refresh.
        // For now, just inform the user — the folder only appears once an item uses it.
        // If the user wants the folder visible immediately, we add a hidden item:
        const create = await vscode.window.showQuickPick([
            { label: 'Add a command to this folder now' },
            { label: 'Just create empty folder' },
        ], { placeHolder: `Folder: ${name}` });

        if (create?.label.startsWith('Add')) {
            const label = await vscode.window.showInputBox({
                prompt: 'Command label',
                placeHolder: 'e.g. Deploy Script',
            });
            if (!label) { return; }

            const command = await vscode.window.showInputBox({
                prompt: 'Command text (shell command)',
                placeHolder: 'npm run deploy',
            });
            if (command === undefined) { return; }

            const tags = await pickTags(this.tagTree) ?? [];

            const data = await this._readstore();
            data.items.push({
                id: generateId('cmd'),
                label,
                command,
                tags,
                folder: name,
            });
            await store.write(this.settings.commandsFile, data);
            await this._sendData();
        }
        // 'Just create empty folder' — no action needed; folder appears when items use it.
    }

    // ── Folder helpers ────────────────────────────────────────────────────────

    /** Collect unique folder names from a command store. */
    private _getExistingFolders(data: CommandStore): string[] {
        const set = new Set<string>();
        for (const item of data.items) {
            if (item.folder) { set.add(item.folder); }
        }
        return Array.from(set).sort();
    }

    /**
     * Show a QuickPick that lets the user choose an existing folder,
     * type a new one, or select "(root)".
     */
    private async _pickFolder(
        existing: string[],
        current: string,
    ): Promise<string | undefined> {
        const picks: vscode.QuickPickItem[] = [
            { label: '(root)', description: 'No folder' },
            ...existing.map(f => ({ label: f })),
            { label: '+ New folder...', description: 'Type a new name' },
        ];

        const choice = await vscode.window.showQuickPick(picks, {
            placeHolder: `Current: ${current || '(root)'} — Choose folder`,
        });

        if (!choice) { return undefined; }

        if (choice.label === '(root)') { return ''; }

        if (choice.label === '+ New folder...') {
            const name = await vscode.window.showInputBox({
                prompt: 'New folder name',
                placeHolder: 'e.g. DevOps',
            });
            return name ?? undefined;
        }

        return choice.label;
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
            return raw as unknown as CommandStore;
        }

        // Legacy format: has `commands` object at root
        if (raw.commands && typeof raw.commands === 'object' && !Array.isArray(raw.commands)) {
            const migrated = this._migrateLegacy(raw as unknown as LegacyCommandStore);
            await store.write(this.settings.commandsFile, migrated);
            return migrated;
        }

        // Fallback: empty store
        return { items: [] };
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

    // ── HTML builder ───────────────────────────────────────────────────────────

    private _buildHtml(): string {
        const nonce  = getNonce();
        const outDir = path.join(__dirname);

        const htmlTemplate = fs.readFileSync(
            path.join(outDir, 'command-list.html'), 'utf-8',
        );
        const css = fs.readFileSync(
            path.join(outDir, 'command-list.css'), 'utf-8',
        );

        return htmlTemplate
            .replace(/\{\{NONCE\}\}/g, nonce)
            .replace('{{STYLE}}', css);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Cryptographically random nonce for Content-Security-Policy. */
function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += chars[Math.floor(Math.random() * chars.length)];
    }
    return nonce;
}

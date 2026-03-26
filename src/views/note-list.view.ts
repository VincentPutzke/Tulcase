/**
 * WebviewViewProvider for the Notes sidebar panel.
 *
 * Renders a folder/note tree in the same visual style as TODOs and Commands.
 * Clicking a note opens it in the main editor via the `aplist:` filesystem.
 *
 * HTML lives in src/views/note-list.html.
 * Styles live in src/views/note-list.scss (compiled to out/note-list.css).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { JsonStore } from '../data/json-store';
import { NoteFileSystemProvider } from '../data/note-fs';
import { pickTags } from '../data/tag-picker';
import { generateId } from '../utils/id';
import type { TulcaseSettings } from '../config';
import type {
    NoteItem,
    NoteFolder,
    NoteStore,
} from '../models/note.model';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

export class NoteListViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'tulcase.lists';

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
            case 'open':
                if (msg.id) { await this._openNote(msg.id); }
                break;
            case 'editMeta':
                if (msg.id) { await this._editNoteMeta(msg.id); }
                break;
            case 'delete':
                if (msg.id) { await this._deleteNote(msg.id); }
                break;
            case 'addNote':
                await this._addNote();
                break;
            case 'addNoteToFolder':
                if (msg.id) { await this._addNote(msg.id); }
                break;
            case 'addFolder':
                await this._addFolder();
                break;
            case 'renameFolder':
                if (msg.id) { await this._renameFolder(msg.id); }
                break;
            case 'deleteFolder':
                if (msg.id) { await this._deleteFolder(msg.id); }
                break;
        }
    }

    // ── Data push ─────────────────────────────────────────────────────────────

    /** Load notes + folders + tags and push to the webview. */
    private async _sendData(): Promise<void> {
        if (!this._view) { return; }

        const data   = await this._readStore();
        const tagMap = await this.tagTree.getTagMap();

        this._view.webview.postMessage({
            type:    'updateData',
            notes:   data.notes,
            folders: data.folders,
            tagMap,
        });
    }

    // ── Note operations ───────────────────────────────────────────────────────

    /** Open a note in the main editor area using the virtual filesystem. */
    private async _openNote(id: string): Promise<void> {
        const data = await this._readStore();
        const note = data.notes.find(n => n.id === id);
        if (!note) { return; }

        const uri = NoteFileSystemProvider.uri(note);

        // If already open, just focus it
        const existingTab = vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .find(t =>
                t.input instanceof vscode.TabInputText &&
                t.input.uri.toString() === uri.toString(),
            );

        if (existingTab) {
            // Tabs API doesn't expose a focus method → open same URI (VS Code reuses the tab)
        }

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });

        // Set language mode to markdown for syntax highlighting
        await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
    }

    private async _addNote(folderId?: string): Promise<void> {
        const label = await vscode.window.showInputBox({
            prompt: 'Note name',
            placeHolder: 'e.g. Meeting notes',
        });
        if (!label) { return; }

        const tags = await pickTags(this.tagTree) ?? [];

        const data     = await this._readStore();
        const now      = new Date().toISOString().slice(0, 10);

        const note: NoteItem = {
            id: generateId('nt'),
            label,
            content: '',
            tags,
            folder: folderId ?? '',
            createdAt: now,
            updatedAt: now,
        };

        data.notes.push(note);
        await store.write(this.settings.listsFile, data);
        await this._sendData();

        // Immediately open the new note
        await this._openNote(note.id);
    }

    private async _editNoteMeta(id: string): Promise<void> {
        const data = await this._readStore();
        const note = data.notes.find(n => n.id === id);
        if (!note) { return; }

        const field = await vscode.window.showQuickPick([
            { label: 'Name',   description: note.label },
            { label: 'Tags',   description: note.tags.join(', ') || '(none)' },
            { label: 'Folder', description: this._folderName(data, note.folder) || '(root)' },
        ], { placeHolder: 'Edit note metadata' });

        if (!field) { return; }

        if (field.label === 'Name') {
            const v = await vscode.window.showInputBox({ prompt: 'Note name', value: note.label });
            if (v !== undefined) { note.label = v; }
        } else if (field.label === 'Tags') {
            const picked = await pickTags(this.tagTree, note.tags);
            if (picked) { note.tags = picked; }
        } else if (field.label === 'Folder') {
            const folder = await this._pickFolder(data, note.folder);
            if (folder !== undefined) { note.folder = folder; }
        }

        note.updatedAt = new Date().toISOString().slice(0, 10);
        await store.write(this.settings.listsFile, data);
        await this._sendData();
    }

    private async _deleteNote(id: string): Promise<void> {
        const data = await this._readStore();
        const note = data.notes.find(n => n.id === id);
        if (!note) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `Delete note "${note.label}"?`, { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }

        data.notes = data.notes.filter(n => n.id !== id);
        await store.write(this.settings.listsFile, data);
        await this._sendData();
    }

    // ── Folder operations ─────────────────────────────────────────────────────

    private async _addFolder(parentId?: string): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Folder name',
            placeHolder: 'e.g. Work',
        });
        if (!name) { return; }

        const data = await this._readStore();

        // If no parentId, let the user choose where to place it
        let parent = parentId ?? '';
        if (!parentId && data.folders.length > 0) {
            const choice = await this._pickParentFolder(data);
            if (choice === undefined) { return; }
            parent = choice;
        }

        data.folders.push({
            id: generateId('nf'),
            name,
            parent,
        });

        await store.write(this.settings.listsFile, data);
        await this._sendData();
    }

    private async _renameFolder(id: string): Promise<void> {
        const data = await this._readStore();
        const folder = data.folders.find(f => f.id === id);
        if (!folder) { return; }

        const name = await vscode.window.showInputBox({
            prompt: 'Folder name',
            value: folder.name,
        });
        if (name === undefined) { return; }

        folder.name = name;
        await store.write(this.settings.listsFile, data);
        await this._sendData();
    }

    private async _deleteFolder(id: string): Promise<void> {
        const data = await this._readStore();
        const folder = data.folders.find(f => f.id === id);
        if (!folder) { return; }

        // Count items that would be affected
        const notesInFolder = data.notes.filter(n => n.folder === id);
        const subFolders = data.folders.filter(f => f.parent === id);
        const total = notesInFolder.length + subFolders.length;

        const message = total > 0
            ? `Delete folder "${folder.name}" and move its ${total} item(s) to root?`
            : `Delete empty folder "${folder.name}"?`;

        const confirm = await vscode.window.showWarningMessage(
            message, { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }

        // Move child notes and sub-folders to root
        for (const n of notesInFolder) { n.folder = ''; }
        for (const f of subFolders)    { f.parent = ''; }

        data.folders = data.folders.filter(f => f.id !== id);
        await store.write(this.settings.listsFile, data);
        await this._sendData();
    }

    // ── Folder picker helpers ─────────────────────────────────────────────────

    /** Get a human-readable name for a folder ID. */
    private _folderName(data: NoteStore, folderId: string): string {
        if (!folderId) { return ''; }
        return data.folders.find(f => f.id === folderId)?.name ?? '';
    }

    /** QuickPick to move a note into an existing folder, root, or new folder. */
    private async _pickFolder(
        data: NoteStore,
        currentFolderId: string,
    ): Promise<string | undefined> {
        const currentName = this._folderName(data, currentFolderId) || '(root)';

        const picks: vscode.QuickPickItem[] = [
            { label: '(root)', description: 'No folder' },
            ...data.folders.map(f => ({
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
                placeHolder: 'e.g. Projects',
            });
            if (!name) { return undefined; }

            const newFolder: NoteFolder = {
                id: generateId('nf'),
                name,
                parent: '',
            };
            data.folders.push(newFolder);
            return newFolder.id;
        }

        // Return the folder ID stored in 'description'
        return choice.description ?? '';
    }

    /** QuickPick to choose a parent folder (for sub-folder creation). */
    private async _pickParentFolder(data: NoteStore): Promise<string | undefined> {
        const picks: vscode.QuickPickItem[] = [
            { label: '(root)', description: 'Top level' },
            ...data.folders.map(f => ({
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
     * Read the note store, migrating from the legacy MiniList format
     * to the new notes/folders format if necessary.
     */
    private async _readStore(): Promise<NoteStore> {
        const raw = await store.read<Record<string, unknown>>(
            this.settings.listsFile,
            { notes: [], folders: [] },
        );
        // New format: has `notes` array
        if (Array.isArray(raw.notes)) {
            return raw as unknown as NoteStore;
        }

        // Do not attempt to migrate or modify legacy files. If the file
        // does not match the new shape, return an empty store so we never
        // write or change the user's existing `lists.json`.
        return { notes: [], folders: [] };
    }

    // Legacy migration removed: do not convert or write legacy `lists.json`.
    // The Notes feature intentionally ignores older repository formats.

    // ── HTML builder ───────────────────────────────────────────────────────────

    private _buildHtml(): string {
        const nonce  = getNonce();
        const outDir = path.join(__dirname);

        const htmlTemplate = fs.readFileSync(
            path.join(outDir, 'note-list.html'), 'utf-8',
        );
        const css = fs.readFileSync(
            path.join(outDir, 'note-list.css'), 'utf-8',
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

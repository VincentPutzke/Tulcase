/**
 * Virtual file-system provider for the `aplist:` URI scheme.
 *
 * Each note is exposed as `aplist:/<noteId>/<label>.md` so that VS Code
 * opens it in the main editor area with a readable tab title.
 *
 * Read/write operations go through JsonStore, keeping `lists.json` as
 * the single source of truth.
 */

import * as vscode from 'vscode';
import { JsonStore } from './json-store';
import type { TulcaseSettings } from '../config';
import type { NoteStore, NoteItem } from '../models/note.model';

const store = new JsonStore();

export class NoteFileSystemProvider implements vscode.FileSystemProvider {
    static readonly scheme = 'aplist';

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;

    constructor(private readonly settings: TulcaseSettings) {}

    // ── URI helpers ───────────────────────────────────────────────────────────

    /** Build a URI for a given note. */
    static uri(note: NoteItem): vscode.Uri {
        const safeName = note.label.replace(/[\\/:*?"<>|]/g, '_');
        return vscode.Uri.parse(`${NoteFileSystemProvider.scheme}:/${note.id}/${safeName}.md`);
    }

    /** Extract the note ID from a URI. */
    static noteId(uri: vscode.Uri): string {
        // Path is /<noteId>/<label>.md — first segment after leading '/'
        return uri.path.split('/')[1] ?? '';
    }

    // ── FileSystemProvider ────────────────────────────────────────────────────

    watch(): vscode.Disposable {
        // We control all writes, so no-op watching.
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const note = await this._findNote(uri);
        if (!note) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        const content = Buffer.byteLength(note.content, 'utf-8');
        const mtime = new Date(note.updatedAt).getTime() || Date.now();
        return {
            type: vscode.FileType.File,
            ctime: new Date(note.createdAt).getTime() || mtime,
            mtime,
            size: content,
        };
    }

    readDirectory(): [string, vscode.FileType][] {
        // We don't expose directory listings.
        return [];
    }

    createDirectory(): void {
        // no-op
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const note = await this._findNote(uri);
        if (!note) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return Buffer.from(note.content, 'utf-8');
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const id = NoteFileSystemProvider.noteId(uri);
        const data = await this._readStore();
        const note = data.notes.find(n => n.id === id);
        if (!note) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }

        note.content = Buffer.from(content).toString('utf-8');
        note.updatedAt = new Date().toISOString().slice(0, 10);
        await store.write(this.settings.listsFile, data);

        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    delete(): void {
        // Deletion is handled via the sidebar, not the filesystem.
        throw vscode.FileSystemError.NoPermissions('Delete notes from the sidebar.');
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions('Rename notes from the sidebar.');
    }

    // ── Fire change event (called by the extension on external data change) ──

    /** Notify VS Code that the content of a note may have changed. */
    fireChanged(uri: vscode.Uri): void {
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private async _readStore(): Promise<NoteStore> {
        return store.read<NoteStore>(this.settings.listsFile, { notes: [], folders: [] });
    }

    private async _findNote(uri: vscode.Uri): Promise<NoteItem | undefined> {
        const id = NoteFileSystemProvider.noteId(uri);
        const data = await this._readStore();
        return data.notes.find(n => n.id === id);
    }
}

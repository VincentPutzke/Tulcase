/**
 * File-system provider for the `tulcase-script:` URI scheme.
 *
 * Each script is exposed as `tulcase-script:/<scriptId>/<label>.sh` so VS Code
 * opens it in the main editor area with a readable tab title and shell-script
 * highlighting.
 *
 * Unlike the Notes provider (which stores content inside lists.json), reads and
 * writes here are proxied to a **real `.sh` file on disk** at
 * `{scriptsDir}/<scriptId>.sh`.  That keeps the body runnable, syncable as a
 * plain file, and editable like any other file — while `scripts.json` holds
 * only the metadata.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { JsonStore } from './json-store';
import type { TulcaseSettings } from '../config';
import type { ScriptStore, ScriptItem } from '../models/script.model';

const store = new JsonStore();

export class ScriptFileSystemProvider implements vscode.FileSystemProvider {
    static readonly scheme = 'tulcase-script';

    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this._emitter.event;

    constructor(private readonly settings: TulcaseSettings) {}

    // ── URI / path helpers ──────────────────────────────────────────────────

    /** Build the editor URI for a given script. */
    static uri(item: ScriptItem): vscode.Uri {
        const safeName = (item.label || item.id).replace(/[\\/:*?"<>|]/g, '_');
        return vscode.Uri.parse(`${ScriptFileSystemProvider.scheme}:/${item.id}/${safeName}.sh`);
    }

    /** Extract the script ID from an editor URI. */
    static scriptId(uri: vscode.Uri): string {
        // Path is /<scriptId>/<label>.sh — first segment after the leading '/'.
        return uri.path.split('/')[1] ?? '';
    }

    /** Absolute on-disk path of a script's backing .sh file. */
    static diskPath(settings: TulcaseSettings, id: string): string {
        return path.join(settings.scriptsDir, `${id}.sh`);
    }

    private _diskPath(id: string): string {
        return ScriptFileSystemProvider.diskPath(this.settings, id);
    }

    // ── FileSystemProvider ──────────────────────────────────────────────────

    watch(): vscode.Disposable {
        // We mediate all writes through the editor, so no external watching.
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const id = ScriptFileSystemProvider.scriptId(uri);
        try {
            const s = await fs.stat(this._diskPath(id));
            return {
                type: vscode.FileType.File,
                ctime: s.ctimeMs,
                mtime: s.mtimeMs,
                size: s.size,
            };
        } catch {
            // Backing file not created yet — present an empty file so the editor
            // can open it; the first save materialises the real file.
            const now = Date.now();
            return { type: vscode.FileType.File, ctime: now, mtime: now, size: 0 };
        }
    }

    readDirectory(): [string, vscode.FileType][] {
        return [];
    }

    createDirectory(): void {
        // no-op
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const id = ScriptFileSystemProvider.scriptId(uri);
        try {
            return await fs.readFile(this._diskPath(id));
        } catch {
            return new Uint8Array();
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        const id = ScriptFileSystemProvider.scriptId(uri);
        const diskPath = this._diskPath(id);

        await fs.mkdir(path.dirname(diskPath), { recursive: true });
        await fs.writeFile(diskPath, Buffer.from(content));

        // Bump the script's updatedAt so sync's double-edit resolution stays meaningful.
        await this._touchUpdatedAt(id);

        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    delete(): void {
        // Deletion is handled via the sidebar (it also removes metadata).
        throw vscode.FileSystemError.NoPermissions('Delete scripts from the sidebar.');
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions('Rename scripts from the sidebar.');
    }

    /** Notify VS Code that a script's backing file may have changed externally. */
    fireChanged(uri: vscode.Uri): void {
        this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    // ── Internal helpers ────────────────────────────────────────────────────

    private async _touchUpdatedAt(id: string): Promise<void> {
        try {
            const data = await store.read<ScriptStore>(this.settings.scriptsFile, { items: [], folders: [] });
            const item = data.items.find(s => s.id === id);
            if (!item) { return; }
            item.updatedAt = new Date().toISOString().slice(0, 10);
            await store.write(this.settings.scriptsFile, data);
        } catch {
            // Metadata bump is best-effort; never block the save.
        }
    }
}

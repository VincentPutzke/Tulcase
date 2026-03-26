/**
 * Inline tag decorations for note documents opened with the `aplist:` scheme.
 *
 * Scans the document for `#tagname` patterns and applies coloured background
 * decorations matching the tag's colour in the tag store. Decorations are
 * updated on every edit, debounced to 300 ms.
 */

import * as vscode from 'vscode';
import { NoteFileSystemProvider } from './note-fs';
import type { TagTreeProvider } from '../providers/tag-tree.provider';
import type { TagDef } from '../models/tag.model';

/** Matches `#tagname` (word-boundary, letters/digits/hyphens/underscores). */
const TAG_REGEX = /#([\w-]+)/g;

/**
 * Manages tag decorations for all open `aplist:` documents.
 * Register once at activation; it listens to editor/document events.
 */
export class NoteTagDecorator implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _timeout: ReturnType<typeof setTimeout> | undefined;

    /** One decoration type per tag colour so they can share styles. */
    private _decoTypeCache = new Map<string, vscode.TextEditorDecorationType>();

    constructor(private readonly tagTree: TagTreeProvider) {
        // Trigger on active editor change
        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor && this._isNoteDoc(editor.document)) {
                    this._triggerUpdate(editor);
                }
            }),
        );

        // Trigger on document edits (debounced)
        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument(e => {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === e.document && this._isNoteDoc(e.document)) {
                    this._triggerUpdate(editor);
                }
            }),
        );

        // Initial decoration for the active editor
        if (vscode.window.activeTextEditor && this._isNoteDoc(vscode.window.activeTextEditor.document)) {
            this._triggerUpdate(vscode.window.activeTextEditor);
        }
    }

    /** Force a refresh of decorations (e.g. after tags change). */
    refreshAll(): void {
        for (const editor of vscode.window.visibleTextEditors) {
            if (this._isNoteDoc(editor.document)) {
                void this._updateDecorations(editor);
            }
        }
    }

    dispose(): void {
        if (this._timeout) { clearTimeout(this._timeout); }
        for (const dt of this._decoTypeCache.values()) { dt.dispose(); }
        this._decoTypeCache.clear();
        for (const d of this._disposables) { d.dispose(); }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private _isNoteDoc(doc: vscode.TextDocument): boolean {
        return doc.uri.scheme === NoteFileSystemProvider.scheme;
    }

    private _triggerUpdate(editor: vscode.TextEditor): void {
        if (this._timeout) { clearTimeout(this._timeout); }
        this._timeout = setTimeout(() => this._updateDecorations(editor), 300);
    }

    private async _updateDecorations(editor: vscode.TextEditor): Promise<void> {
        const tagMap = await this.tagTree.getTagMap();

        // Group ranges by colour so we can batch-apply decorations
        const colourRanges = new Map<string, vscode.Range[]>();

        const text = editor.document.getText();
        let match: RegExpExecArray | null;
        TAG_REGEX.lastIndex = 0;

        while ((match = TAG_REGEX.exec(text)) !== null) {
            const tagName = match[1];
            const def: TagDef | undefined = tagMap[tagName];
            if (!def) { continue; }

            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            const range = new vscode.Range(startPos, endPos);

            const colour = def.color;
            if (!colourRanges.has(colour)) { colourRanges.set(colour, []); }
            colourRanges.get(colour)!.push(range);
        }

        // Clear all previous decorations
        for (const dt of this._decoTypeCache.values()) {
            editor.setDecorations(dt, []);
        }

        // Apply new decorations grouped by colour
        for (const [colour, ranges] of colourRanges) {
            const dt = this._getDecoType(colour);
            editor.setDecorations(dt, ranges);
        }
    }

    /** Get or create a decoration type for a given hex colour. */
    private _getDecoType(colour: string): vscode.TextEditorDecorationType {
        if (this._decoTypeCache.has(colour)) {
            return this._decoTypeCache.get(colour)!;
        }

        const dt = vscode.window.createTextEditorDecorationType({
            backgroundColor: `${colour}22`,       // 13% opacity background
            borderRadius: '3px',
            color: colour,
            fontWeight: '600',
        });

        this._decoTypeCache.set(colour, dt);
        return dt;
    }
}

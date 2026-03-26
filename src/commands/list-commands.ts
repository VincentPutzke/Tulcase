/**
 * Palette command registration for the Notes feature.
 *
 * `tulcase.note.add`  — triggers the guided add-note dialog in the Notes panel.
 *                       Also wired to the view/title "+" button.
 * `tulcase.note.open` — shows a searchable tree-picker of all notes grouped
 *                       by folder; opens the selected note in the main editor.
 */

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { NoteFileSystemProvider } from '../data/note-fs';
import { showTreePicker } from '../data/tree-picker';
import type { TulcaseSettings } from '../config';
import type { NoteStore } from '../models/note.model';
import type { NoteListViewProvider } from '../views/note-list.view';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

export function registerListCommands(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    noteList: NoteListViewProvider,
    _tagTree: TagTreeProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.note.add', () => {
            // Focus the Notes panel and open the guided add-note dialog.
            vscode.commands.executeCommand('tulcase.lists.focus');
            noteList.addNoteFromPalette();
        }),
        vscode.commands.registerCommand('tulcase.note.open', () =>
            openNoteFromPicker(settings),
        ),
    );
}

async function openNoteFromPicker(settings: TulcaseSettings): Promise<void> {
    const data = await store.read<NoteStore>(
        settings.listsFile,
        { notes: [], folders: [] },
    );

    if (!data.notes || data.notes.length === 0) {
        vscode.window.showInformationMessage(
            'No notes found. Add one via the Notes view.',
        );
        return;
    }

    // Build a folder-id → folder-name lookup for grouping
    const folderNames = new Map<string, string>();
    for (const f of data.folders ?? []) {
        folderNames.set(f.id, f.name);
    }

    const items = data.notes
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(note => {
            // Use the tag list (or first content line) as the description
            const description = note.tags.length > 0
                ? note.tags.join('  ')
                : (note.content.split('\n').find(l => l.trim()) ?? '').slice(0, 60);

            return {
                label:       note.label,
                description,
                group:       note.folder
                    ? (folderNames.get(note.folder) ?? note.folder)
                    : undefined,
                data:        note,
            };
        });

    const selected = await showTreePicker({
        title:       'Open Note',
        placeholder: 'Type to filter — select a note to open in the editor',
        items,
    });

    if (!selected) { return; }

    const uri = NoteFileSystemProvider.uri(selected);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
}


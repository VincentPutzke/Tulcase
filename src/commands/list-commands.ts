/**
 * Palette-only commands for the Note system (v0.6+).
 *
 * Most interactions happen directly through the webview sidebar; these
 * commands exist for the Command Palette and keybinding convenience.
 */

import * as vscode from 'vscode';
import type { NoteListViewProvider } from '../views/note-list.view';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

export function registerListCommands(
    context: vscode.ExtensionContext,
    noteList: NoteListViewProvider,
    _tagTree: TagTreeProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.note.add', () => {
            // Trigger the same 'addNote' flow that the webview button uses
            vscode.commands.executeCommand('tulcase.lists.focus');
            // Give the view a moment to focus, then post message
            setTimeout(() => noteList.refresh(), 200);
        }),
    );
}

import * as vscode from 'vscode';
import type { TagListViewProvider } from '../views/tag-list.view';

/**
 * Register tag-related VS Code commands.
 *
 * Tag operations (rename, colour, category, delete) are handled inline inside
 * the Tags webview panel. Only `tulcase.tag.add` is exposed as a palette command
 * so users can create tags without opening the panel first.
 */
export function registerTagCommands(
    context: vscode.ExtensionContext,
    _settings: unknown,
    tagList: TagListViewProvider,
    _refreshAll: () => void,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.tag.add', () => tagList.addTagFromPalette()),
    );
}

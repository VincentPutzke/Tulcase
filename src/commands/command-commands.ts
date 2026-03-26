import * as vscode from 'vscode';
import type { TulcaseSettings } from '../config';
import type { CommandListViewProvider } from '../views/command-list.view';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

/**
 * Register palette-level command handlers.
 *
 * All inline actions (edit, copy, run-in-terminal, delete) are handled by the
 * webview itself. These palette commands provide keyboard-accessible entry points.
 */
export function registerCommandCommands(
    context: vscode.ExtensionContext,
    _settings: TulcaseSettings,
    _commandList: CommandListViewProvider,
    _tagTree: TagTreeProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.command.add', () => {
            // Trigger add flow in the webview provider
            vscode.commands.executeCommand('tulcase.commands.focus');
        }),
    );
}

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { showTreePicker } from '../data/tree-picker';
import type { TulcaseSettings } from '../config';
import type { CommandStore } from '../models/command.model';
import type { CommandListViewProvider } from '../views/command-list.view';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

/**
 * Register palette-level command handlers for the Commands feature.
 *
 * `tulcase.command.add`    — triggers the guided add-command dialog in the
 *                            Commands webview panel (label → text → tags → folder).
 * `tulcase.command.copy`   — searchable tree-picker → copies command text to clipboard.
 * `tulcase.command.insert` — searchable tree-picker → inserts command text into the
 *                            active (or a new) integrated terminal, ready to run.
 *
 * All inline actions in the Commands panel (edit, run-in-terminal, delete)
 * are handled by CommandListViewProvider via webview message passing.
 */
export function registerCommandCommands(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    commandList: CommandListViewProvider,
    _tagTree: TagTreeProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.command.add', () => {
            commandList.addCommandFromPalette();
        }),
        vscode.commands.registerCommand('tulcase.command.copy', () =>
            copyCommandFromPicker(settings),
        ),
        vscode.commands.registerCommand('tulcase.command.insert', () =>
            insertCommandInTerminal(settings),
        ),
    );
}

async function copyCommandFromPicker(settings: TulcaseSettings): Promise<void> {
    const data = await store.read<CommandStore>(settings.commandsFile, { items: [] });

    const items = data.items.map(cmd => ({
        label:       cmd.label,
        // Show a truncated snippet of the command text as the secondary description
        description: cmd.command.length > 70
            ? cmd.command.slice(0, 70) + '…'
            : cmd.command,
        // Group by folder; root-level commands have no group
        group:       cmd.folder || undefined,
        data:        cmd,
    }));

    const selected = await showTreePicker({
        title:        'Copy Command',
        placeholder:  'Type to filter — select a command to copy to clipboard',
        items,
        emptyMessage: 'No commands found. Add one via the Commands view.',
    });

    if (!selected) { return; }

    await vscode.env.clipboard.writeText(selected.command);
    vscode.window.showInformationMessage(`Copied: ${selected.label}`);
}

// ── Insert Command ─────────────────────────────────────────────────────────────

async function insertCommandInTerminal(settings: TulcaseSettings): Promise<void> {
    const data = await store.read<CommandStore>(settings.commandsFile, { items: [] });

    const items = data.items.map(cmd => ({
        label:       cmd.label,
        description: cmd.command.length > 70
            ? cmd.command.slice(0, 70) + '…'
            : cmd.command,
        group:       cmd.folder || undefined,
        data:        cmd,
    }));

    const selected = await showTreePicker({
        title:        'Insert Command in Terminal',
        placeholder:  'Type to filter — select a command to insert into the terminal',
        items,
        emptyMessage: 'No commands found. Add one via the Commands view.',
    });

    if (!selected) { return; }

    // Reuse the active terminal if one is open; otherwise create a dedicated one.
    const terminal = vscode.window.activeTerminal
        ?? vscode.window.createTerminal('Tulcase');

    // Show terminal but keep focus in the editor (preserveFocus = true).
    terminal.show(true);

    // Insert the command text without a trailing newline so the user can
    // review and press Enter themselves before the command actually runs.
    terminal.sendText(selected.command, false);
}


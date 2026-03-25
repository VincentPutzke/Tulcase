import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import type { ArbeitsplatzSettings } from '../config';
import type { CommandStore } from '../models/command.model';
import type { CommandTreeProvider, CommandTreeItem } from '../providers/command-tree.provider';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

export function registerCommandCommands(
    context: vscode.ExtensionContext,
    settings: ArbeitsplatzSettings,
    commandTree: CommandTreeProvider,
    tagTree: TagTreeProvider
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.command.add', () => addCommand(settings, commandTree, tagTree)),
        vscode.commands.registerCommand('arbeitsplatz.command.copy', (item: CommandTreeItem) => copyCommand(item)),
        vscode.commands.registerCommand('arbeitsplatz.command.runInTerminal', (item: CommandTreeItem) => runInTerminal(item)),
        vscode.commands.registerCommand('arbeitsplatz.command.edit', (item: CommandTreeItem) => editCommand(settings, commandTree, tagTree, item)),
        vscode.commands.registerCommand('arbeitsplatz.command.delete', (item: CommandTreeItem) => deleteCommand(settings, commandTree, item)),
    );
}

async function addCommand(settings: ArbeitsplatzSettings, commandTree: CommandTreeProvider, tagTree: TagTreeProvider): Promise<void> {
    const label = await vscode.window.showInputBox({ prompt: 'Command label', placeHolder: 'git status' });
    if (!label) { return; }

    const command = await vscode.window.showInputBox({ prompt: 'Command text', placeHolder: 'git status --short' });
    if (!command) { return; }

    const tagMap = await tagTree.getTagMap();
    const tagNames = Object.keys(tagMap);
    let tags: string[] = [];
    if (tagNames.length > 0) {
        const picked = await vscode.window.showQuickPick(
            tagNames.map(t => ({ label: t })),
            { canPickMany: true, placeHolder: 'Select tags (optional)' }
        );
        tags = picked?.map(p => p.label) ?? [];
    }

    const data = await store.read<CommandStore>(settings.commandsFile, { commands: {} });
    data.commands[label] = { command, tags };
    await store.write(settings.commandsFile, data);
    commandTree.refresh();
    vscode.window.showInformationMessage(`Command added: ${label}`);
}

async function copyCommand(item: CommandTreeItem): Promise<void> {
    await vscode.env.clipboard.writeText(item.entry.command);
    vscode.window.showInformationMessage(`Copied: ${item.entry.command}`);
}

async function runInTerminal(item: CommandTreeItem): Promise<void> {
    let terminal = vscode.window.activeTerminal;
    if (!terminal) {
        terminal = vscode.window.createTerminal('Arbeitsplatz');
    }
    terminal.show();
    terminal.sendText(item.entry.command);
    vscode.window.showInformationMessage(`Sent to terminal: ${item.entry.command}`);
}

async function editCommand(settings: ArbeitsplatzSettings, commandTree: CommandTreeProvider, tagTree: TagTreeProvider, item: CommandTreeItem): Promise<void> {
    const field = await vscode.window.showQuickPick([
        { label: 'Command text', description: item.entry.command },
        { label: 'Tags', description: item.entry.tags.join(', ') },
    ], { placeHolder: 'What to edit?' });

    if (!field) { return; }

    const data = await store.read<CommandStore>(settings.commandsFile, { commands: {} });
    const entry = data.commands[item.commandLabel];
    if (!entry || typeof entry === 'string') { return; }

    if (field.label === 'Command text') {
        const newCommand = await vscode.window.showInputBox({ prompt: 'New command text', value: entry.command });
        if (newCommand !== undefined) {
            entry.command = newCommand;
        }
    } else if (field.label === 'Tags') {
        const tagMap = await tagTree.getTagMap();
        const allTags = Object.keys(tagMap);
        const picked = await vscode.window.showQuickPick(
            allTags.map(t => ({ label: t, picked: entry.tags.includes(t) })),
            { canPickMany: true, placeHolder: 'Select tags' }
        );
        if (picked) {
            entry.tags = picked.map(p => p.label);
        }
    }

    await store.write(settings.commandsFile, data);
    commandTree.refresh();
}

async function deleteCommand(settings: ArbeitsplatzSettings, commandTree: CommandTreeProvider, item: CommandTreeItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `Delete command "${item.commandLabel}"?`,
        { modal: true },
        'Delete'
    );
    if (confirm !== 'Delete') { return; }

    const data = await store.read<CommandStore>(settings.commandsFile, { commands: {} });
    delete data.commands[item.commandLabel];
    await store.write(settings.commandsFile, data);
    commandTree.refresh();
}

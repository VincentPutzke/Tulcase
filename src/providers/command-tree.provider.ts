import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import type { ArbeitsplatzSettings } from '../config';
import type { CommandStore, CommandEntry } from '../models/command.model';

/** A single command/snippet item in the tree */
export class CommandTreeItem extends vscode.TreeItem {
    constructor(
        public readonly commandLabel: string,
        public readonly entry: CommandEntry
    ) {
        super(commandLabel, vscode.TreeItemCollapsibleState.None);
        this.description = entry.command;
        this.tooltip = `${commandLabel}\n${entry.command}${entry.tags.length ? '\nTags: ' + entry.tags.join(', ') : ''}`;
        this.contextValue = 'commandItem';
        this.iconPath = new vscode.ThemeIcon('terminal');
    }
}

export class CommandTreeProvider implements vscode.TreeDataProvider<CommandTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<CommandTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private store = new JsonStore();

    constructor(private settings: ArbeitsplatzSettings) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: CommandTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: CommandTreeItem): Promise<CommandTreeItem[]> {
        if (element) {
            return [];
        }

        const data = await this.store.read<CommandStore>(this.settings.commandsFile, { commands: {} });
        const commands = data.commands ?? {};

        return Object.entries(commands)
            .map(([label, entry]) => {
                // Handle legacy string format
                if (typeof entry === 'string') {
                    return new CommandTreeItem(label, { command: entry, tags: [] });
                }
                return new CommandTreeItem(label, entry);
            })
            .sort((a, b) => a.commandLabel.localeCompare(b.commandLabel));
    }
}

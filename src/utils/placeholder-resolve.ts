import * as vscode from 'vscode';
import type { CommandItem } from '../models/command.model';
import { parsePlaceholders, applyPlaceholders } from './placeholder';

/**
 * Prompt the user to fill in every placeholder in the command.
 *
 * - Placeholders with default values → QuickPick + "Custom…" option.
 * - Placeholders without defaults   → InputBox.
 *
 * @returns The fully resolved command string, or `undefined` if the user
 *          cancelled any prompt.
 */
export async function resolveCommand(
    item: CommandItem,
): Promise<string | undefined> {
    const names = parsePlaceholders(item.command);
    if (names.length === 0) { return item.command; }

    const placeholders = item.placeholders ?? {};
    const values: Record<string, string> = {};

    for (const name of names) {
        const def = placeholders[name];
        const defaults = def?.defaults ?? [];

        let value: string | undefined;

        if (defaults.length > 0) {
            // Show QuickPick with defaults + custom option
            const picks: vscode.QuickPickItem[] = [
                ...defaults.map(d => ({ label: d })),
                { label: '$(pencil) Custom…', description: 'Enter a custom value' },
            ];

            const picked = await vscode.window.showQuickPick(picks, {
                title: `Placeholder: <$${name}$>`,
                placeHolder: `Choose a value for <$${name}$>`,
            });

            if (!picked) { return undefined; }

            if (picked.label === '$(pencil) Custom…') {
                value = await vscode.window.showInputBox({
                    title: `Placeholder: <$${name}$>`,
                    prompt: `Enter value for <$${name}$>`,
                });
                if (value === undefined) { return undefined; }
            } else {
                value = picked.label;
            }
        } else {
            // No defaults — free-text input
            value = await vscode.window.showInputBox({
                title: `Placeholder: <$${name}$>`,
                prompt: `Enter value for <$${name}$>`,
            });
            if (value === undefined) { return undefined; }
        }

        values[name] = value;
    }

    return applyPlaceholders(item.command, values);
}

import * as vscode from 'vscode';
import type { CommandItem, PlaceholderDef } from '../models/command.model';

/** Regex that matches `<$name$>` placeholder tokens. */
const PLACEHOLDER_RE = /<\$([^$]+)\$>/g;

// ── Pure helpers (no VS Code dependency) ──────────────────────────────────────

/**
 * Extract unique placeholder names from a command string
 * in the order of their first appearance.
 *
 * ```
 * parsePlaceholders('git checkout <$branch$> && echo <$msg$> <$branch$>')
 * // → ['branch', 'msg']
 * ```
 */
export function parsePlaceholders(command: string): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    let match: RegExpExecArray | null;

    // Reset lastIndex in case RE was used before
    PLACEHOLDER_RE.lastIndex = 0;
    while ((match = PLACEHOLDER_RE.exec(command)) !== null) {
        const name = match[1];
        if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }

    return names;
}

/**
 * Replace every `<$name$>` token in `command` with the corresponding value
 * from `values`.  Tokens whose name is not in `values` are left as-is.
 */
export function applyPlaceholders(
    command: string,
    values: Record<string, string>,
): string {
    return command.replace(PLACEHOLDER_RE, (full, name: string) => {
        return Object.prototype.hasOwnProperty.call(values, name)
            ? values[name]
            : full;
    });
}

/**
 * Remove keys from `placeholders` that no longer appear in `command`.
 * Returns a cleaned copy (or `undefined` if nothing remains).
 */
export function prunePlaceholders(
    command: string,
    placeholders: Record<string, PlaceholderDef> | undefined,
): Record<string, PlaceholderDef> | undefined {
    if (!placeholders) { return undefined; }

    const active = new Set(parsePlaceholders(command));
    const result: Record<string, PlaceholderDef> = {};
    let count = 0;

    for (const [name, def] of Object.entries(placeholders)) {
        if (active.has(name)) {
            result[name] = def;
            count++;
        }
    }

    return count > 0 ? result : undefined;
}

// ── VS Code–dependent resolution ──────────────────────────────────────────────

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

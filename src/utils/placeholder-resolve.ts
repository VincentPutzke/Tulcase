import * as vscode from 'vscode';
import type { CommandItem } from '../models/command.model';
import { parsePlaceholders, applyPlaceholders } from './placeholder';

/**
 * Prompt the user to fill in every placeholder in the command.
 *
 * Uses a `createQuickPick` widget for every placeholder so the user can:
 *   1. Type any custom value freely.
 *   2. Optionally use arrow keys (or a click) to select one of the pre-defined
 *      default values.
 *   3. Press Enter — whatever is in the input field (typed text or the label of
 *      the highlighted suggestion) becomes the value.
 *
 * Pressing Escape at any point cancels the entire operation.
 *
 * @returns The fully resolved command string, or `undefined` if cancelled.
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

        const value = await promptPlaceholder(name, defaults);
        if (value === undefined) { return undefined; }

        values[name] = value;
    }

    return applyPlaceholders(item.command, values);
}

/**
 * Show a single-placeholder prompt using `createQuickPick`.
 *
 * The widget shows default values as selectable suggestions while still
 * allowing the user to type any custom value without an extra step.
 *
 * Resolution priority on Enter:
 *   - A highlighted list item → use its label (covers arrow-key selection and
 *     typed text that exactly matches a default).
 *   - Nothing highlighted   → use the raw typed text.
 *
 * @returns The entered/selected value, or `undefined` on Escape / cancel.
 */
function promptPlaceholder(name: string, defaults: string[]): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        const qp = vscode.window.createQuickPick();
        qp.title       = `Placeholder: <$${name}$>`;
        qp.placeholder = defaults.length > 0
            ? `Type a value or select a suggestion for <$${name}$>`
            : `Enter value for <$${name}$>`;
        qp.items       = defaults.map(d => ({ label: d }));

        let accepted = false;

        qp.onDidAccept(() => {
            accepted = true;
            // Prefer a highlighted suggestion; fall back to the typed text.
            const selected = qp.selectedItems[0];
            resolve(selected ? selected.label : qp.value);
            qp.hide();
        });

        qp.onDidHide(() => {
            if (!accepted) { resolve(undefined); }
            qp.dispose();
        });

        qp.show();
    });
}

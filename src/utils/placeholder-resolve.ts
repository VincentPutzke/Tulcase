import * as vscode from 'vscode';
import type { CommandItem, PlaceholderDef } from '../models/command.model';
import { parsePlaceholders, applyPlaceholders } from './placeholder';

// ── Ctrl+Enter "force custom value" support ───────────────────────────────────
// A module-level callback that the registered command invokes to resolve the
// active placeholder prompt with the raw typed text instead of the selection.
let _forceCustomCallback: (() => void) | undefined;

/**
 * Register the `tulcase.internal.forceCustomValue` command that lets the user
 * press Ctrl+Enter to submit the typed text even when a list item is highlighted.
 * Call once at extension activation.
 */
export function registerPlaceholderCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.internal.forceCustomValue', () => {
            _forceCustomCallback?.();
        }),
    );
}

/**
 * Prompt the user to fill in every placeholder in the command.
 *
 * Uses a `createQuickPick` widget for every placeholder so the user can:
 *   1. Type any custom value freely.
 *   2. Optionally use arrow keys (or a click) to select one of the pre-defined
 *      default values.
 *   3. Press Enter — accepts the highlighted suggestion, or the typed text
 *      when nothing is highlighted.
 *   4. Press Ctrl+Enter — always accepts the raw typed text, ignoring any
 *      highlighted suggestion.
 *
 * Pressing Escape at any point cancels the entire operation.
 *
 * @returns The fully resolved command string, or `undefined` if cancelled.
 */
export async function resolveCommand(
    item: CommandItem,
): Promise<string | undefined> {
    return resolveText(item.command, item.placeholders);
}

/**
 * Resolve every `<$name$>` placeholder in an arbitrary text body (a command
 * string or a multi-line script), prompting the user for each one.
 *
 * Shares the exact prompting behaviour of {@link resolveCommand} — defaults are
 * offered as selectable suggestions, Enter takes the highlighted item or the
 * typed text, Ctrl+Enter always takes the typed text, Escape cancels.
 *
 * @returns The text with all placeholders substituted, or `undefined` if the
 *          user cancelled (so callers can abort the run/copy).
 */
export async function resolveText(
    text: string,
    placeholders: Record<string, PlaceholderDef> | undefined,
): Promise<string | undefined> {
    const names = parsePlaceholders(text);
    if (names.length === 0) { return text; }

    const defs = placeholders ?? {};
    const values: Record<string, string> = {};

    for (const name of names) {
        const defaults = defs[name]?.defaults ?? [];

        const value = await promptPlaceholder(name, defaults);
        if (value === undefined) { return undefined; }

        values[name] = value;
    }

    return applyPlaceholders(text, values);
}

/**
 * Show a single-placeholder prompt using `createQuickPick`.
 *
 * The widget shows default values as selectable suggestions while still
 * allowing the user to type any custom value without an extra step.
 *
 * Resolution priority:
 *   - **Enter**: highlighted list item → its label; nothing highlighted → typed text.
 *   - **Ctrl+Enter**: always the raw typed text, regardless of highlighting.
 *
 * @returns The entered/selected value, or `undefined` on Escape / cancel.
 */
function promptPlaceholder(name: string, defaults: string[]): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => {
        const qp = vscode.window.createQuickPick();
        qp.title       = `Placeholder: <$${name}$>`;
        qp.placeholder = defaults.length > 0
            ? `Type or select for <$${name}$>  (Ctrl+Enter = use typed text)`
            : `Enter value for <$${name}$>`;
        qp.items       = defaults.map(d => ({ label: d }));

        let settled = false;

        const finish = (value: string | undefined) => {
            if (settled) { return; }
            settled = true;
            resolve(value);
            qp.hide();
        };

        // Normal Enter — prefer highlighted suggestion, fall back to typed text.
        qp.onDidAccept(() => {
            const selected = qp.selectedItems[0];
            finish(selected ? selected.label : qp.value);
        });

        // Ctrl+Enter — always use the raw typed text.
        _forceCustomCallback = () => finish(qp.value);

        qp.onDidHide(() => {
            _forceCustomCallback = undefined;
            if (!settled) { resolve(undefined); }
            qp.dispose();
        });

        qp.show();
    });
}

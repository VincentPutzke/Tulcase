/**
 * Palette command registration for Database management.
 *
 * `tulcase.db.export`  — pick a saved database → serialise → clipboard
 * `tulcase.db.import`  — read clipboard → deserialise → save as new database
 * `tulcase.db.switch`  — pick a saved database → restore into active slot → refresh all
 * `tulcase.db.update`  — pick a saved database → overwrite it with current live data
 */

import * as vscode from 'vscode';
import {
    listDatabases,
    snapshotTo,
    restoreFrom,
    exportDatabase,
    importDatabase,
} from '../data/db-manager';
import type { TulcaseSettings } from '../config';

// ── Registration ───────────────────────────────────────────────────────────────

export function registerDbCommands(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    refreshAll: () => void,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.db.export', () =>
            dbExport(settings),
        ),
        vscode.commands.registerCommand('tulcase.db.import', () =>
            dbImport(settings, refreshAll),
        ),
        vscode.commands.registerCommand('tulcase.db.switch', () =>
            dbSwitch(settings, refreshAll),
        ),
        vscode.commands.registerCommand('tulcase.db.update', () =>
            dbUpdate(settings),
        ),
    );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Show a QuickPick of all saved databases and return the selected name.
 * Returns `undefined` when no databases exist or the user cancels.
 */
async function pickDatabase(
    settings: TulcaseSettings,
    placeHolder: string,
): Promise<string | undefined> {
    const names = await listDatabases(settings);

    if (names.length === 0) {
        vscode.window.showInformationMessage(
            'No saved databases found. Use "Update Database" to save the current state first.',
        );
        return undefined;
    }

    return vscode.window.showQuickPick(names, { placeHolder });
}

// ── Command implementations ────────────────────────────────────────────────────

/**
 * **Export Database** — pick a saved database, serialise it, copy to clipboard.
 */
async function dbExport(settings: TulcaseSettings): Promise<void> {
    const name = await pickDatabase(
        settings,
        'Select a database to export to clipboard',
    );
    if (!name) { return; }

    try {
        const payload = await exportDatabase(settings, name);
        await vscode.env.clipboard.writeText(payload);
        vscode.window.showInformationMessage(
            `Database "${name}" exported to clipboard.`,
        );
    } catch (err) {
        vscode.window.showErrorMessage(
            `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

/**
 * **Import Database** — read a Tulcase export from the clipboard, ask for a
 * local name, and persist it as a new saved database.
 */
async function dbImport(
    settings: TulcaseSettings,
    refreshAll: () => void,
): Promise<void> {
    const payload = await vscode.env.clipboard.readText();

    if (!payload.trim()) {
        vscode.window.showWarningMessage(
            'Clipboard is empty. Copy a Tulcase database export first.',
        );
        return;
    }

    const localName = await vscode.window.showInputBox({
        prompt: 'Name for the imported database',
        placeHolder: 'e.g. work, personal, shared',
        validateInput: (v) => {
            const trimmed = v.trim();
            if (!trimmed) { return 'Name cannot be empty'; }
            if (/[<>:"/\\|?*]/.test(trimmed)) {
                return 'Name contains invalid characters';
            }
            return undefined;
        },
    });
    if (!localName) { return; }

    try {
        const savedName = await importDatabase(settings, payload, localName.trim());
        vscode.window.showInformationMessage(
            `Database imported as "${savedName}".`,
        );

        // Ask the user if they want to switch to the newly imported database
        const action = await vscode.window.showInformationMessage(
            `Switch to "${savedName}" now?`,
            'Switch',
            'Later',
        );
        if (action === 'Switch') {
            await restoreFrom(settings, savedName);
            refreshAll();
            vscode.window.showInformationMessage(
                `Switched to database "${savedName}".`,
            );
        }
    } catch (err) {
        vscode.window.showErrorMessage(
            `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

/**
 * **Switch Database** — pick a saved database and restore it as the active
 * data set.  The current live data is **not** auto-saved — prompt the user.
 */
async function dbSwitch(
    settings: TulcaseSettings,
    refreshAll: () => void,
): Promise<void> {
    const name = await pickDatabase(
        settings,
        'Select a database to switch to',
    );
    if (!name) { return; }

    // Safety prompt: the user may lose unsaved changes
    const confirm = await vscode.window.showWarningMessage(
        `This will overwrite your current data with "${name}". ` +
        'Save current state first with "Update Database" if needed. Continue?',
        { modal: true },
        'Switch',
    );
    if (confirm !== 'Switch') { return; }

    try {
        await restoreFrom(settings, name);
        refreshAll();
        vscode.window.showInformationMessage(
            `Switched to database "${name}".`,
        );
    } catch (err) {
        vscode.window.showErrorMessage(
            `Switch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

/**
 * **Update Database** — pick a saved database (or create a new one) and
 * overwrite it with the current live data.
 */
async function dbUpdate(settings: TulcaseSettings): Promise<void> {
    const existing = await listDatabases(settings);

    // Build a QuickPick with existing names + a "Create new…" option
    const CREATE_NEW = '$(add) Create new database…';
    const items = [...existing, CREATE_NEW];

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a database to update — or create a new one',
    });
    if (!picked) { return; }

    let targetName: string;

    if (picked === CREATE_NEW) {
        const newName = await vscode.window.showInputBox({
            prompt: 'Name for the new database',
            placeHolder: 'e.g. work, personal, shared',
            validateInput: (v) => {
                const trimmed = v.trim();
                if (!trimmed) { return 'Name cannot be empty'; }
                if (/[<>:"/\\|?*]/.test(trimmed)) {
                    return 'Name contains invalid characters';
                }
                return undefined;
            },
        });
        if (!newName) { return; }
        targetName = newName.trim();
    } else {
        targetName = picked;
    }

    try {
        await snapshotTo(settings, targetName);
        vscode.window.showInformationMessage(
            `Database "${targetName}" updated with current data.`,
        );
    } catch (err) {
        vscode.window.showErrorMessage(
            `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

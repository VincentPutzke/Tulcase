/**
 * Palette command registration for Database management.
 *
 * `tulcase.db.export`  — pick a database → serialise → clipboard
 * `tulcase.db.import`  — clipboard → new database (optionally switch)
 * `tulcase.db.switch`  — pick a database → switch active → refresh
 * `tulcase.db.update`  — clipboard → overwrite existing database (cross-workspace sync)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    listDatabases,
    createDatabase,
    exportDatabase,
    importDatabase,
} from '../data/db-manager';
import { switchSettingsTo, writeLastUpdated } from '../config';
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
            dbUpdate(settings, refreshAll),
        ),
    );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Show a QuickPick of all saved databases and return the selected name. */
async function pickDatabase(
    settings: TulcaseSettings,
    placeHolder: string,
): Promise<string | undefined> {
    const names = await listDatabases(settings);

    if (names.length === 0) {
        vscode.window.showInformationMessage(
            'No databases found. Create one with "Switch Database" → "Create new…".',
        );
        return undefined;
    }

    return vscode.window.showQuickPick(names, { placeHolder });
}

/** Validate a database name (for input boxes). */
function validateDbName(v: string): string | undefined {
    const trimmed = v.trim();
    if (!trimmed) { return 'Name cannot be empty'; }
    if (/[<>:"/\\|?*]/.test(trimmed)) {
        return 'Name contains invalid characters';
    }
    return undefined;
}

// ── Command implementations ────────────────────────────────────────────────────

/**
 * **Export Database** — pick a database, serialise it, copy to clipboard.
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
 * local name, and persist it as a new database.  Offers to switch immediately.
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
        validateInput: validateDbName,
    });
    if (!localName) { return; }

    try {
        const savedName = await importDatabase(settings, payload, localName.trim());
        // Record the import timestamp
        writeLastUpdated(path.join(settings.rootDir, 'data', savedName));

        vscode.window.showInformationMessage(
            `Database imported as "${savedName}".`,
        );

        const action = await vscode.window.showInformationMessage(
            `Switch to "${savedName}" now?`,
            'Switch',
            'Later',
        );
        if (action === 'Switch') {
            switchSettingsTo(settings, savedName);
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
 * **Switch Database** — pick (or create) a database and switch to it.
 * No confirmation needed — all data is already written in-place.
 */
async function dbSwitch(
    settings: TulcaseSettings,
    refreshAll: () => void,
): Promise<void> {
    const existing = await listDatabases(settings);

    const CREATE_NEW = '$(add) Create new database…';
    const items = [...existing, CREATE_NEW];

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a database to switch to',
    });
    if (!picked) { return; }

    let targetName: string;

    if (picked === CREATE_NEW) {
        const newName = await vscode.window.showInputBox({
            prompt: 'Name for the new database',
            placeHolder: 'e.g. work, personal, shared',
            validateInput: v => {
                const err = validateDbName(v);
                if (err) { return err; }
                if (existing.includes(v.trim())) {
                    return 'A database with this name already exists';
                }
                return undefined;
            },
        });
        if (!newName) { return; }
        targetName = newName.trim();
        await createDatabase(settings, targetName);
    } else {
        targetName = picked;
    }

    if (targetName === settings.activeDb) {
        vscode.window.showInformationMessage(
            `Already on database "${targetName}".`,
        );
        return;
    }

    switchSettingsTo(settings, targetName);
    refreshAll();
    vscode.window.showInformationMessage(
        `Switched to database "${targetName}".`,
    );
}

/**
 * **Update Database** — read clipboard, overwrite the local database that
 * shares the same name.  Used to sync a database across workspaces.
 */
async function dbUpdate(
    settings: TulcaseSettings,
    refreshAll: () => void,
): Promise<void> {
    const payload = await vscode.env.clipboard.readText();

    if (!payload.trim()) {
        vscode.window.showWarningMessage(
            'Clipboard is empty. Export a database on the source workspace first.',
        );
        return;
    }

    try {
        // importDatabase with no localName override uses the bundle's own name
        const savedName = await importDatabase(settings, payload);
        // Record the update timestamp
        const dbDir = path.join(settings.rootDir, 'data', savedName);
        writeLastUpdated(dbDir);

        vscode.window.showInformationMessage(
            `Database "${savedName}" updated from clipboard.`,
        );

        // If the updated database is the active one, refresh views
        if (savedName === settings.activeDb) {
            refreshAll();
        }
    } catch (err) {
        vscode.window.showErrorMessage(
            `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

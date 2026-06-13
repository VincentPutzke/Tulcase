/**
 * Shared logic for running a saved script in the integrated terminal.
 *
 * Used by both the Scripts sidebar (inline ▶ action) and the
 * `tulcase.script.run` quick-run palette picker so behaviour stays identical:
 *
 *   1. Read the script's backing `.sh` file from disk.
 *   2. Unless the body carries the trust marker, ask the user to confirm.
 *   3. Resolve any `<$name$>` placeholders (prompting per placeholder).
 *   4. If placeholders were substituted, run a resolved temp copy; otherwise
 *      run the real file directly.
 *   5. Send `<interpreter> '<path>'` to the active (or a new) terminal and run.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ScriptFileSystemProvider } from './script-fs';
import { resolveText } from '../utils/placeholder-resolve';
import { isTrustedScript } from '../utils/script-trust';
import type { TulcaseSettings } from '../config';
import type { ScriptItem } from '../models/script.model';

export { isTrustedScript } from '../utils/script-trust';

/** Counter to keep generated temp filenames unique within a session. */
let tempCounter = 0;

/**
 * Run a script in the integrated terminal.
 *
 * @returns `true` if the script was sent to a terminal, `false` if the user
 *          cancelled or the script could not be run.
 */
export async function runScriptInTerminal(
    settings: TulcaseSettings,
    item: ScriptItem,
): Promise<boolean> {
    const diskPath = ScriptFileSystemProvider.diskPath(settings, item.id);

    let content: string;
    try {
        content = await fs.readFile(diskPath, 'utf-8');
    } catch {
        vscode.window.showWarningMessage(
            `Script "${item.label}" has no saved content yet. Open and edit it first.`,
        );
        return false;
    }

    if (content.trim().length === 0) {
        vscode.window.showWarningMessage(`Script "${item.label}" is empty.`);
        return false;
    }

    // ── Safety confirmation (skipped for trusted scripts) ───────────────────
    if (!isTrustedScript(content)) {
        const confirm = await vscode.window.showWarningMessage(
            `Run script "${item.label}"?`,
            {
                modal: true,
                detail: 'Add a "# tulcase: no-confirm" comment to the script to skip this prompt.',
            },
            'Run',
        );
        if (confirm !== 'Run') { return false; }
    }

    // ── Resolve placeholders ────────────────────────────────────────────────
    const resolved = await resolveText(content, item.placeholders);
    if (resolved === undefined) { return false; } // cancelled

    // If placeholders changed the body, run a throwaway resolved copy so the
    // saved file keeps its `<$name$>` tokens intact.
    const pathToRun = resolved === content
        ? diskPath
        : await writeTempScript(item.id, resolved);

    const interpreter = vscode.workspace
        .getConfiguration('tulcase')
        .get<string>('scripts.interpreter', 'bash')
        .trim() || 'bash';

    const terminal = vscode.window.activeTerminal
        ?? vscode.window.createTerminal('Tulcase Scripts');

    terminal.show();
    terminal.sendText(`${interpreter} ${shellQuote(pathToRun)}`, true);
    return true;
}

/** Write a resolved script body to a temp .sh file and return its path. */
async function writeTempScript(id: string, content: string): Promise<string> {
    const dir = path.join(os.tmpdir(), 'tulcase-scripts');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${id}-${Date.now()}-${tempCounter++}.sh`);
    await fs.writeFile(file, content, 'utf-8');
    return file;
}

/** Quote a path for a bash/sh command line (single-quote, escape embedded quotes). */
function shellQuote(p: string): string {
    return `'${p.replace(/'/g, `'\\''`)}'`;
}

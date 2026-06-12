import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { showTreePicker } from '../data/tree-picker';
import { ScriptFileSystemProvider } from '../data/script-fs';
import { runScriptInTerminal } from '../data/script-runner';
import type { TulcaseSettings } from '../config';
import type { ScriptItem, ScriptStore } from '../models/script.model';
import type { ScriptListViewProvider } from '../views/script-list.view';
import type { TagTreeProvider } from '../providers/tag-tree.provider';

const store = new JsonStore();

/**
 * Register palette-level command handlers for the Scripts feature.
 *
 * `tulcase.script.add`  — guided add-script dialog in the Scripts view.
 * `tulcase.script.open` — searchable tree-picker → opens the .sh in the editor.
 * `tulcase.script.run`  — searchable tree-picker → confirms, resolves
 *                         placeholders, and runs the script in the terminal.
 *
 * Inline actions in the Scripts panel (run, open, edit, delete) are handled by
 * ScriptListViewProvider via webview message passing.
 */
export function registerScriptCommands(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    scriptList: ScriptListViewProvider,
    _tagTree: TagTreeProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('tulcase.script.add', () => {
            scriptList.addScriptFromPalette();
        }),
        vscode.commands.registerCommand('tulcase.script.open', () =>
            openScriptFromPicker(settings),
        ),
        vscode.commands.registerCommand('tulcase.script.run', () =>
            runScriptFromPicker(settings),
        ),
    );
}

/** Build folder-grouped tree-picker items from the script store. */
function buildPickerItems(data: ScriptStore) {
    const folderNames = new Map<string, string>();
    for (const f of data.folders) { folderNames.set(f.id, f.name); }

    return data.items
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label))
        .map(script => ({
            label:       script.label,
            description: script.description || script.tags.join('  '),
            group:       script.folder ? (folderNames.get(script.folder) ?? script.folder) : undefined,
            data:        script,
        }));
}

async function openScriptFromPicker(settings: TulcaseSettings): Promise<void> {
    const data = await store.read<ScriptStore>(settings.scriptsFile, { items: [], folders: [] });

    const selected = await showTreePicker<ScriptItem>({
        title:        'Open Script',
        placeholder:  'Type to filter — select a script to open in the editor',
        items:        buildPickerItems(data),
        emptyMessage: 'No scripts found. Add one via the Scripts view.',
    });
    if (!selected) { return; }

    const uri = ScriptFileSystemProvider.uri(selected);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.languages.setTextDocumentLanguage(doc, 'shellscript');
}

async function runScriptFromPicker(settings: TulcaseSettings): Promise<void> {
    const data = await store.read<ScriptStore>(settings.scriptsFile, { items: [], folders: [] });

    const selected = await showTreePicker<ScriptItem>({
        title:        'Run Script',
        placeholder:  'Type to filter — select a script to run in the terminal',
        items:        buildPickerItems(data),
        emptyMessage: 'No scripts found. Add one via the Scripts view.',
    });
    if (!selected) { return; }

    await runScriptInTerminal(settings, selected);
}

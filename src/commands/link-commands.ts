/**
 * Palette command registration for the Links feature.
 *
 * `tulcase.link.open` — searchable tree-picker → opens the selected URL in the
 *                       default browser.
 * `tulcase.link.grab` — same tree-picker → copies the selected URL to the
 *                       clipboard (handy for pasting into code, docs, PRs…).
 *
 * `tulcase.link.add`  — hidden from palette; kept so the Links webview's own
 *                       "+" button and programmatic callers can reach the add
 *                       flow via `addLinkFromPalette()`.
 */

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { showTreePicker } from '../data/tree-picker';
import type { TulcaseSettings } from '../config';
import type { LinkNode, LinkStore } from '../models/link.model';
import type { LinkListViewProvider } from '../views/link-list.view';

const store = new JsonStore();

export function registerLinkCommands(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    linkList: LinkListViewProvider,
): void {
    context.subscriptions.push(
        // Hidden from palette; kept for programmatic access and the webview flow.
        vscode.commands.registerCommand('tulcase.link.add', () => {
            linkList.addLinkFromPalette();
        }),
        vscode.commands.registerCommand('tulcase.link.open', () =>
            openLinkFromPicker(settings),
        ),
        vscode.commands.registerCommand('tulcase.link.grab', () =>
            grabLinkFromPicker(settings),
        ),
    );
}

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Load the link store, flatten the recursive folder tree into a flat list, and
 * show the searchable tree-picker.  Returns the selected {@link LinkNode} or
 * `undefined` if the user cancelled.
 */
async function pickLink(
    settings: TulcaseSettings,
    title: string,
    placeholder: string,
): Promise<LinkNode | undefined> {
    const data = await store.read<LinkStore>(settings.linksFile, { root: [] });

    type FlatLink = { node: LinkNode; folderPath: string };
    const flat: FlatLink[] = [];
    flattenLinks(data.root, '', flat);

    const items = flat
        .filter(f => f.node.type === 'link' && f.node.url)
        .map(({ node, folderPath }) => ({
            label:       node.label,
            description: node.url ?? '',
            group:       folderPath || undefined,
            data:        node,
        }));

    return showTreePicker({
        title,
        placeholder,
        items,
        emptyMessage: 'No links found. Add one via the Links view.',
    });
}

// ── Command implementations ───────────────────────────────────────────────────

async function openLinkFromPicker(settings: TulcaseSettings): Promise<void> {
    const selected = await pickLink(
        settings,
        'Open Link',
        'Type to filter — select a link to open in the browser',
    );
    if (!selected?.url) { return; }

    await vscode.env.openExternal(vscode.Uri.parse(selected.url));
}

async function grabLinkFromPicker(settings: TulcaseSettings): Promise<void> {
    const selected = await pickLink(
        settings,
        'Grab Link URL',
        'Type to filter — select a link to copy its URL to the clipboard',
    );
    if (!selected?.url) { return; }

    await vscode.env.clipboard.writeText(selected.url);
    vscode.window.showInformationMessage(`Copied: ${selected.url}`);
}

// ── Tree-flattening utility ───────────────────────────────────────────────────

/**
 * Recursively walk the link tree and collect every leaf node (type `'link'`)
 * together with the human-readable path of its parent folder chain.
 */
function flattenLinks(
    nodes: LinkNode[],
    currentPath: string,
    result: Array<{ node: LinkNode; folderPath: string }>,
): void {
    for (const node of nodes) {
        if (node.type === 'folder') {
            const childPath = currentPath
                ? `${currentPath} / ${node.label}`
                : node.label;
            if (node.children) {
                flattenLinks(node.children, childPath, result);
            }
        } else {
            result.push({ node, folderPath: currentPath });
        }
    }
}


/**
 * Palette command registration for the Links feature.
 *
 * `tulcase.link.open` — shows a searchable tree-picker of all bookmarks grouped
 *                       by folder; opens the selected URL in the default browser.
 *
 * `tulcase.link.add`  — kept registered (hidden from palette) so that the
 *                       LinkListViewProvider can trigger the add-link flow via
 *                       the webview's own "+" button.  External callers that
 *                       want to add a link programmatically can still execute
 *                       this command; it delegates to `addLinkFromPalette()`.
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
            vscode.commands.executeCommand('tulcase.links.focus');
            linkList.addLinkFromPalette();
        }),
        vscode.commands.registerCommand('tulcase.link.open', () =>
            openLinkFromPicker(settings),
        ),
    );
}

async function openLinkFromPicker(settings: TulcaseSettings): Promise<void> {
    const data = await store.read<LinkStore>(settings.linksFile, { root: [] });

    // Flatten the recursive tree into a list of link nodes with their folder path
    type FlatLink = { node: LinkNode; folderPath: string };
    const flat: FlatLink[] = [];
    flattenLinks(data.root, '', flat);

    const linkItems = flat.filter(f => f.node.type === 'link' && f.node.url);

    const items = linkItems.map(({ node, folderPath }) => ({
        label:       node.label,
        description: node.url ?? '',
        group:       folderPath || undefined,
        data:        node,
    }));

    const selected = await showTreePicker({
        title:        'Open Link',
        placeholder:  'Type to filter — select a link to open in the browser',
        items,
        emptyMessage: 'No links found. Add one via the Links view.',
    });

    if (!selected?.url) { return; }

    await vscode.env.openExternal(vscode.Uri.parse(selected.url));
}

/**
 * Recursively walk the link tree and collect every leaf-node (type `'link'`)
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


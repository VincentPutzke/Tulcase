/**
 * Palette command registration for Links.
 *
 * All link CRUD operations are handled inside LinkListViewProvider via
 * webview messages.  This module only exposes palette commands that
 * delegate to the webview provider so they can be invoked externally
 * (e.g. keyboard shortcuts, command palette).
 */

import * as vscode from 'vscode';
import type { ArbeitsplatzSettings } from '../config';
import type { LinkListViewProvider } from '../views/link-list.view';

export function registerLinkCommands(
    context: vscode.ExtensionContext,
    _settings: ArbeitsplatzSettings,
    linkList: LinkListViewProvider,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('arbeitsplatz.link.add', () => {
            // Focus the Links panel and tell it to trigger add-link flow
            vscode.commands.executeCommand('arbeitsplatz.links.focus');
            // The actual add-link logic happens inside the webview provider;
            // the provider exposes a public method for external callers.
            linkList.addLinkFromPalette();
        }),
    );
}

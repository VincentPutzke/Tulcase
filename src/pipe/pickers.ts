/**
 * Shared native pickers used by both the command flows and the scope editor.
 */

import * as vscode from 'vscode';
import type { GitLabClient } from './gitlab-client';
import { describeApiError } from './gitlab-client';

/**
 * Search GitLab for a project (membership only) and return the chosen
 * path-with-namespace, or undefined when cancelled / nothing found.
 */
export async function pickProjectViaSearch(client: GitLabClient): Promise<string | undefined> {
    const query = await vscode.window.showInputBox({
        title: 'Search GitLab projects',
        placeHolder: 'Part of the project name or path…',
        ignoreFocusOut: true,
    });
    if (!query?.trim()) { return undefined; }

    try {
        const hits = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Searching projects for "${query.trim()}"…` },
            () => client.searchProjects(query.trim()),
        );
        if (hits.length === 0) {
            vscode.window.showInformationMessage(`No projects found for "${query.trim()}".`);
            return undefined;
        }
        const picked = await vscode.window.showQuickPick(
            hits.map(h => ({ label: h.pathWithNamespace, description: h.description })),
            { title: 'Choose project', ignoreFocusOut: true },
        );
        return picked?.label;
    } catch (err) {
        vscode.window.showErrorMessage(`Tulcase Pipe: project search failed — ${describeApiError(err)}`);
        return undefined;
    }
}

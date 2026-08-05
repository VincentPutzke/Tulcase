/**
 * VS Code adapter around the pure {@link downloadVersion} orchestration.
 *
 * Supplies the injected side effects — folder picker, filesystem existence /
 * streaming writes, and the conflict quick pick — and wraps the whole run in a
 * cancellable progress notification. Files stream straight to disk (never
 * buffered whole in memory), the object-storage redirect is followed without
 * leaking the private token (handled in the client), and a token lacking the
 * package-registry read scope is reported as a clear hint rather than a raw 403.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import type { GitLabClient } from '../pipe/gitlab-client';
import { GitLabApiError, describeApiError } from '../pipe/gitlab-client';
import type { RegistryNode } from './registry-tree';
import { downloadVersion, type ConflictChoice } from './registry-download';

/** Default download target: the first workspace folder, if any. */
function defaultTargetUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Native quick pick resolving a single file-name clash. */
async function pickConflict(fileName: string): Promise<ConflictChoice> {
    const picked = await vscode.window.showQuickPick(
        [
            { label: 'Overwrite', choice: 'overwrite' as const },
            { label: 'Overwrite all', choice: 'overwrite-all' as const },
            { label: 'Skip', choice: 'skip' as const },
            { label: 'Skip all', choice: 'skip-all' as const },
            { label: 'Cancel download', choice: 'cancel' as const },
        ],
        {
            title: `"${fileName}" already exists`,
            placeHolder: 'Choose how to resolve the name clash',
            ignoreFocusOut: true,
        },
    );
    // Dismissing the picker (Esc) aborts the whole download.
    return picked?.choice ?? 'cancel';
}

/**
 * Download every file of a generic package version into a user-chosen folder.
 * Returns silently after showing its own toasts; never throws.
 */
export async function runVersionDownload(
    client: GitLabClient,
    node: RegistryNode,
    ensureToken: () => Promise<boolean>,
): Promise<void> {
    if (node.kind !== 'version' || !node.downloadable) {
        vscode.window.showWarningMessage('This package version cannot be downloaded.');
        return;
    }
    if (!node.projectRef || !node.packageName || !node.version || node.packageId == null) {
        vscode.window.showErrorMessage('Tulcase Registry: incomplete package version metadata.');
        return;
    }
    if (!(await ensureToken())) { return; }

    // Where to?
    const folderPick = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri: defaultTargetUri(),
        openLabel: 'Download here',
        title: `Download "${node.packageName} ${node.version}" into…`,
    });
    const targetDir = folderPick?.[0]?.fsPath;
    if (!targetDir) { return; }

    // Which files? (already deduped by name in the client)
    let files;
    try {
        files = await client.listPackageFiles(node.projectRef, node.packageId);
    } catch (err) {
        vscode.window.showErrorMessage(scopeAwareMessage(err));
        return;
    }
    if (files.length === 0) {
        vscode.window.showWarningMessage(`No files found for ${node.packageName} ${node.version}.`);
        return;
    }

    const controller = new AbortController();
    let cancelled = false;

    let result;
    try {
        result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Downloading ${node.packageName} ${node.version}`,
            cancellable: true,
        },
        async (progress, token) => {
            token.onCancellationRequested(() => { cancelled = true; controller.abort(); });
            const total = files!.length;

            return downloadVersion({
                files: files!.map(f => ({ fileName: f.fileName, size: f.size })),
                exists: async (fileName) => {
                    try { await fs.promises.access(path.join(targetDir, fileName)); return true; }
                    catch { return false; }
                },
                saveFile: async (fileName) => {
                    const url = client.genericPackageFileUrl(
                        node.projectRef!, node.packageName!, node.version!, fileName,
                    );
                    const res = await client.fetchPackageFile(url, controller.signal);
                    if (!res.body) { throw new Error(`Empty response for ${fileName}.`); }
                    const dest = path.join(targetDir, fileName);
                    // Stream to disk — never buffer the whole file in memory.
                    await pipeline(
                        Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
                        fs.createWriteStream(dest),
                    );
                    const expected = files!.find(f => f.fileName === fileName)?.size;
                    if (expected != null) {
                        const { size } = await fs.promises.stat(dest);
                        if (size !== expected) {
                            throw new Error(
                                `${fileName}: size mismatch (expected ${expected}, got ${size}).`,
                            );
                        }
                    }
                },
                resolveConflict: pickConflict,
                isCancelled: () => cancelled || token.isCancellationRequested,
                onProgress: (fileName, index, count) => {
                    progress.report({
                        message: `${fileName} (${index + 1}/${count})`,
                        increment: 100 / total,
                    });
                },
            });
        },
        );
    } catch (err) {
        vscode.window.showErrorMessage(scopeAwareMessage(err));
        return;
    }

    if (!result) { return; }

    const parts = [`${result.written.length} written`];
    if (result.skipped.length) { parts.push(`${result.skipped.length} skipped`); }
    if (result.cancelled) {
        vscode.window.showWarningMessage(
            `Download cancelled — ${parts.join(', ')} into ${targetDir}.`,
        );
    } else {
        vscode.window.showInformationMessage(
            `Downloaded ${node.packageName} ${node.version}: ${parts.join(', ')} into ${targetDir}.`,
        );
    }
}

/** Map an auth failure to the package-registry-scope hint; else describe it. */
function scopeAwareMessage(err: unknown): string {
    if (err instanceof GitLabApiError && (err.status === 401 || err.status === 403)) {
        return 'Tulcase Registry: your GitLab token needs the package-registry read scope '
            + '(`read_package_registry` or `api`). Update it via "Pipe: Set GitLab Token".';
    }
    return `Tulcase Registry: download failed — ${describeApiError(err)}`;
}

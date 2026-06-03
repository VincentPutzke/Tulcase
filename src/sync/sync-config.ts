/**
 * Sync configuration management.
 *
 * - **Repository URL** → stored in VS Code user settings (`tulcase.sync.repoUrl`).
 * - **PAT**            → stored in VS Code SecretStorage (encrypted, per-machine).
 * - **Auto-sync flag** → stored in VS Code user settings (`tulcase.sync.autoSync`).
 */
import * as vscode from 'vscode';

const SECTION       = 'tulcase.sync';
const SECRET_KEY    = 'tulcase.sync.pat';

// ── Read helpers ───────────────────────────────────────────────────────────────

export function getRepoUrl(): string {
    return vscode.workspace.getConfiguration(SECTION).get<string>('repoUrl', '').trim();
}

export function getAutoSync(): boolean {
    return vscode.workspace.getConfiguration(SECTION).get<boolean>('autoSync', true);
}

export async function getPat(secrets: vscode.SecretStorage): Promise<string> {
    return (await secrets.get(SECRET_KEY)) ?? '';
}

// ── Write helpers ──────────────────────────────────────────────────────────────

export async function setRepoUrl(url: string): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION)
        .update('repoUrl', url.trim(), vscode.ConfigurationTarget.Global);
}

export async function setAutoSync(enabled: boolean): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION)
        .update('autoSync', enabled, vscode.ConfigurationTarget.Global);
}

export async function setPat(secrets: vscode.SecretStorage, pat: string): Promise<void> {
    await secrets.store(SECRET_KEY, pat);
}

export async function clearPat(secrets: vscode.SecretStorage): Promise<void> {
    await secrets.delete(SECRET_KEY);
}

// ── Validation ─────────────────────────────────────────────────────────────────

/** Returns true when both repo URL and PAT are configured. */
export async function isConfigured(secrets: vscode.SecretStorage): Promise<boolean> {
    const url = getRepoUrl();
    const pat = await getPat(secrets);
    return url.length > 0 && pat.length > 0;
}

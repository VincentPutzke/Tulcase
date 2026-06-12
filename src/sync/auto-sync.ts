/**
 * Auto-sync watcher.
 *
 * - On activation:  pull latest from remote (if configured).
 * - On data change: debounce → commit + push (if auto-sync enabled).
 *
 * Gracefully handles missing network: errors are logged but do not block.
 */
import * as vscode from 'vscode';
import { SyncService } from './sync-service';
import { getAutoSync, isConfigured } from './sync-config';

const DEBOUNCE_MS = 5_000;

export class AutoSync implements vscode.Disposable {
    private _timer: ReturnType<typeof setTimeout> | undefined;
    private _watcher: vscode.FileSystemWatcher | undefined;
    private _disposables: vscode.Disposable[] = [];
    private _selfWrite = false;   // Guard: ignore changes we caused (pull)

    constructor(
        private readonly syncService: SyncService,
        private readonly secrets: vscode.SecretStorage,
        dataDir: string,
    ) {
        // Watch all files under the data directory
        const pattern = new vscode.RelativePattern(vscode.Uri.file(dataDir), '**/*');
        this._watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this._watcher.onDidChange(() => this._onFileChange());
        this._watcher.onDidCreate(() => this._onFileChange());
        this._watcher.onDidDelete(() => this._onFileChange());

        this._disposables.push(this._watcher);

        // Auto-pull on activation (fire-and-forget, non-blocking)
        void this._initialPull();
    }

    dispose(): void {
        if (this._timer) { clearTimeout(this._timer); }
        for (const d of this._disposables) { d.dispose(); }
    }

    // ── Initial pull ───────────────────────────────────────────────────────────

    private async _initialPull(): Promise<void> {
        if (!getAutoSync()) { return; }
        if (!(await isConfigured(this.secrets))) { return; }
        if (this.syncService.busy) { return; }

        try {
            this._selfWrite = true;
            await this.syncService.setup({ interactive: false });
            await this.syncService.pull({ interactive: false });
        } catch {
            // Network errors are non-fatal on startup
        } finally {
            this._selfWrite = false;
        }
    }

    // ── File-change debounce ───────────────────────────────────────────────────

    private _onFileChange(): void {
        if (this._selfWrite) { return; }
        if (!getAutoSync()) { return; }

        // Debounce: reset timer on every change
        if (this._timer) { clearTimeout(this._timer); }
        this._timer = setTimeout(() => void this._autoCommitPush(), DEBOUNCE_MS);
    }

    private async _autoCommitPush(): Promise<void> {
        if (!(await isConfigured(this.secrets))) { return; }
        if (this.syncService.busy) { return; }

        try {
            this._selfWrite = true;
            await this.syncService.setup({ interactive: false });
            await this.syncService.fullSync({ interactive: false });
        } catch {
            // Network errors are non-fatal for auto-sync
        } finally {
            this._selfWrite = false;
        }
    }
}

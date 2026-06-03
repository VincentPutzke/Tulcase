/**
 * High-level sync service.
 *
 * Orchestrates git operations for the Tulcase data directory.
 * All public methods are serialised through an internal lock so concurrent
 * calls never corrupt the repository.
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as git from './git-cli';
import { getRepoUrl, getPat } from './sync-config';
import type { TulcaseSettings } from '../config';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SyncStatus =
    | 'not-configured'
    | 'no-git'
    | 'idle'
    | 'syncing'
    | 'error';

export interface SyncState {
    status: SyncStatus;
    lastSync?: string;       // ISO timestamp
    message?: string;        // Human-readable status text
    hasChanges?: boolean;
}

// ── Service ────────────────────────────────────────────────────────────────────

export class SyncService implements vscode.Disposable {
    private _lock = false;
    private _state: SyncState = { status: 'idle' };

    private readonly _onStateChanged = new vscode.EventEmitter<SyncState>();
    readonly onStateChanged = this._onStateChanged.event;

    constructor(
        private readonly settings: TulcaseSettings,
        private readonly secrets: vscode.SecretStorage,
    ) {}

    get state(): SyncState { return { ...this._state }; }

    /** The directory that is synced (rootDir itself). */
    private get dir(): string { return this.settings.rootDir; }

    dispose(): void {
        this._onStateChanged.dispose();
    }

    // ── Public operations ──────────────────────────────────────────────────────

    /** Ensure the data dir is a git repo with origin set.  Returns false on failure. */
    async setup(): Promise<boolean> {
        return this._run('Setting up…', async (url, pat) => {
            // 1. Ensure git is available
            if (!(await git.gitAvailable())) {
                this._fail('Git is not installed or not on PATH.');
                return false;
            }

            // 2. Ensure data dir exists
            fs.mkdirSync(this.dir, { recursive: true });

            // 3. Write .gitignore
            this._ensureGitignore();

            // 4. Init repo if needed
            if (!(await git.isGitRepo(this.dir))) {
                const init = await git.gitInit(this.dir);
                if (init.code !== 0) {
                    this._fail('git init failed: ' + init.stderr);
                    return false;
                }
                await git.configureUser(this.dir, 'Tulcase', 'tulcase@sync');
            }

            // 5. Set remote
            await git.setRemoteUrl(this.dir, url);

            // 6. Initial commit if there are files but no commits yet
            if (await git.hasChanges(this.dir)) {
                await git.gitAdd(this.dir);
                await git.gitCommit(this.dir, this._autoMessage());
            }

            // 7. If remote has commits, pull them in
            if (await git.remoteHasCommits(this.dir, url, pat)) {
                const pull = await git.gitPullRebase(this.dir, url, pat);
                if (pull.code !== 0) {
                    this._fail('Initial pull failed — the remote may have conflicts. ' + pull.stderr);
                    return false;
                }
            }

            return true;
        });
    }

    /** Stage all changes and commit. */
    async commit(): Promise<boolean> {
        return this._run('Committing…', async () => {
            if (!(await git.hasChanges(this.dir))) {
                this._setState({ status: 'idle', message: 'Nothing to commit.' });
                return true;
            }
            await git.gitAdd(this.dir);
            const r = await git.gitCommit(this.dir, this._autoMessage());
            if (r.code !== 0 && !r.stdout.includes('nothing to commit')) {
                this._fail('Commit failed: ' + r.stderr);
                return false;
            }
            return true;
        });
    }

    /** Push to remote. */
    async push(): Promise<boolean> {
        return this._run('Pushing…', async (url, pat) => {
            const r = await git.gitPush(this.dir, url, pat);
            if (r.code !== 0) {
                this._fail('Push failed: ' + r.stderr);
                return false;
            }
            this._setState({
                status: 'idle',
                message: 'Pushed successfully.',
                lastSync: new Date().toISOString(),
            });
            return true;
        });
    }

    /** Fetch and pull (fast-forward only). */
    async pull(): Promise<boolean> {
        return this._run('Pulling…', async (url, pat) => {
            const r = await git.gitPull(this.dir, url, pat);
            if (r.code !== 0) {
                // Distinguish between "already up to date" and real errors
                if (r.stderr.includes('Not possible to fast-forward') || r.stderr.includes('CONFLICT')) {
                    this._fail('Pull failed — remote has diverged. Please resolve manually.');
                    return false;
                }
                this._fail('Pull failed: ' + r.stderr);
                return false;
            }
            this._setState({
                status: 'idle',
                message: 'Pulled successfully.',
                lastSync: new Date().toISOString(),
            });
            return true;
        });
    }

    /** Full sync: commit local changes → pull → push. */
    async fullSync(): Promise<boolean> {
        return this._run('Syncing…', async (url, pat) => {
            // 1. Commit local changes
            if (await git.hasChanges(this.dir)) {
                await git.gitAdd(this.dir);
                const c = await git.gitCommit(this.dir, this._autoMessage());
                if (c.code !== 0 && !c.stdout.includes('nothing to commit')) {
                    this._fail('Commit failed: ' + c.stderr);
                    return false;
                }
            }

            // 2. Pull with rebase (handles the case where both sides have new commits)
            if (await git.remoteHasCommits(this.dir, url, pat)) {
                const p = await git.gitPullRebase(this.dir, url, pat);
                if (p.code !== 0) {
                    if (p.stderr.includes('CONFLICT')) {
                        this._fail('Sync failed — conflicts detected. Please resolve manually.');
                    } else if (!p.stderr.includes('up to date')) {
                        this._fail('Pull failed: ' + p.stderr);
                    }
                    // If "up to date", that's fine — continue to push
                    if (p.code !== 0 && !p.stderr.includes('up to date')) {
                        return false;
                    }
                }
            }

            // 3. Push
            const push = await git.gitPush(this.dir, url, pat);
            if (push.code !== 0) {
                this._fail('Push failed: ' + push.stderr);
                return false;
            }

            this._setState({
                status: 'idle',
                message: 'Synced successfully.',
                lastSync: new Date().toISOString(),
            });
            return true;
        });
    }

    /**
     * Discard all local data and replace it with the remote repository contents.
     * Equivalent to: rm local → clone remote.
     */
    async resetToRemote(): Promise<boolean> {
        return this._run('Resetting to remote…', async (url, pat) => {
            // 1. Ensure git is available
            if (!(await git.gitAvailable())) {
                this._fail('Git is not installed or not on PATH.');
                return false;
            }

            // 2. Ensure data dir exists
            fs.mkdirSync(this.dir, { recursive: true });

            // 3. Write .gitignore
            this._ensureGitignore();

            // 4. Remove existing repo and start fresh
            const gitDir = path.join(this.dir, '.git');
            if (fs.existsSync(gitDir)) {
                fs.rmSync(gitDir, { recursive: true, force: true });
            }

            // 5. Init fresh repo
            const init = await git.gitInit(this.dir);
            if (init.code !== 0) {
                this._fail('git init failed: ' + init.stderr);
                return false;
            }
            await git.configureUser(this.dir, 'Tulcase', 'tulcase@sync');

            // 6. Set remote
            await git.setRemoteUrl(this.dir, url);

            // 7. Fetch remote
            const fetch = await git.gitFetch(this.dir, url, pat);
            if (fetch.code !== 0) {
                this._fail('Fetch failed: ' + fetch.stderr);
                return false;
            }

            // 8. Hard-reset to remote main — overwrites all local files
            const reset = await git.gitResetHard(this.dir, 'FETCH_HEAD');
            if (reset.code !== 0) {
                this._fail('Reset failed: ' + reset.stderr);
                return false;
            }

            // 9. Clean untracked files
            await git.gitClean(this.dir);

            this._setState({
                status: 'idle',
                message: 'Reset to remote complete.',
                lastSync: new Date().toISOString(),
            });
            return true;
        });
    }

    /** Refresh the state (check for uncommitted changes, last commit time). */
    async refreshState(): Promise<void> {
        const url = getRepoUrl();
        const pat = await getPat(this.secrets);

        if (!url || !pat) {
            this._setState({ status: 'not-configured', message: 'Configure repository URL and access token.' });
            return;
        }

        if (!(await git.gitAvailable())) {
            this._setState({ status: 'no-git', message: 'Git is not installed.' });
            return;
        }

        if (!(await git.isGitRepo(this.dir))) {
            this._setState({ status: 'idle', message: 'Not initialised. Click Full Sync to set up.' });
            return;
        }

        const changes = await git.hasChanges(this.dir);
        const lastCommit = await git.lastCommitTime(this.dir);

        this._setState({
            status: 'idle',
            hasChanges: changes,
            lastSync: lastCommit ?? undefined,
            message: changes ? 'Uncommitted changes.' : 'Up to date.',
        });
    }

    // ── Internals ──────────────────────────────────────────────────────────────

    /** Acquire the lock, validate config, run `fn`, release the lock. */
    private async _run(
        statusMsg: string,
        fn: (url: string, pat: string) => Promise<boolean>,
    ): Promise<boolean> {
        if (this._lock) {
            vscode.window.showWarningMessage('A sync operation is already in progress.');
            return false;
        }

        const url = getRepoUrl();
        const pat = await getPat(this.secrets);
        if (!url || !pat) {
            vscode.window.showWarningMessage('Git sync is not configured. Set the repository URL and access token.');
            return false;
        }

        this._lock = true;
        this._setState({ status: 'syncing', message: statusMsg });

        try {
            const ok = await fn(url, pat);
            if (ok) {
                await this.refreshState();
            }
            return ok;
        } catch (err) {
            this._fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        } finally {
            this._lock = false;
        }
    }

    private _fail(message: string): void {
        this._setState({ status: 'error', message });
        vscode.window.showErrorMessage(`Tulcase Sync: ${message}`);
    }

    private _setState(patch: Partial<SyncState>): void {
        Object.assign(this._state, patch);
        this._onStateChanged.fire({ ...this._state });
    }

    private _autoMessage(): string {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        return `Tulcase sync ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    private _ensureGitignore(): void {
        const gitignorePath = path.join(this.dir, '.gitignore');
        const desired = ['.active-database', '.last-updated', '*.tmp'].join('\n') + '\n';
        try {
            const existing = fs.readFileSync(gitignorePath, 'utf-8');
            if (existing === desired) { return; }
        } catch { /* does not exist */ }
        fs.writeFileSync(gitignorePath, desired, 'utf-8');
    }
}

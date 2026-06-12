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
import { mergeStoreFile } from './data-merge';
import { getRepoUrl, getPat } from './sync-config';
import { DATABASES_ROOT, writeActiveDb, type TulcaseSettings } from '../config';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SyncStatus =
    | 'not-configured'
    | 'no-git'
    | 'idle'
    | 'syncing'
    | 'conflict'
    | 'error';

export interface SyncState {
    status: SyncStatus;
    lastSync?: string;       // ISO timestamp
    message?: string;        // Human-readable status text
    hasChanges?: boolean;
}

/** A conflicted file handed to the interactive resolver. */
export interface ConflictFile {
    /** Repo-relative path. */
    path: string;
    /** Friendly display name, e.g. `Notes · database "default"`. */
    label: string;
    base?: string;
    ours?: string;
    theirs?: string;
}

export type ConflictChoice = 'ours' | 'theirs';

/**
 * Interactive resolver delegate (the conflict panel).  Returns a decision
 * per file, or undefined when the user cancelled.
 */
export type ConflictResolver = (
    files: ConflictFile[],
) => Promise<Map<string, ConflictChoice> | undefined>;

/** How an integrate step should handle conflicts it cannot auto-merge. */
export interface SyncOptions {
    /** true: open the resolver UI; false: back off and notify (auto-sync). */
    interactive?: boolean;
}

// ── Service ────────────────────────────────────────────────────────────────────

export class SyncService implements vscode.Disposable {
    private _lock = false;
    private _state: SyncState = { status: 'idle' };
    private readonly _log: vscode.OutputChannel;

    private readonly _onStateChanged = new vscode.EventEmitter<SyncState>();
    readonly onStateChanged = this._onStateChanged.event;

    constructor(
        private readonly settings: TulcaseSettings,
        private readonly secrets: vscode.SecretStorage,
    ) {
        this._log = vscode.window.createOutputChannel('Tulcase Sync');
    }

    get state(): SyncState { return { ...this._state }; }

    /** True while a sync operation holds the lock (auto-sync skips then). */
    get busy(): boolean { return this._lock; }

    /** The directory that is synced (rootDir itself). */
    private get dir(): string { return this.settings.rootDir; }

    /** Interactive conflict resolver (wired to the conflict panel). */
    private _resolver: ConflictResolver | undefined;

    setConflictResolver(resolver: ConflictResolver): void {
        this._resolver = resolver;
    }

    dispose(): void {
        this._onStateChanged.dispose();
        this._log.dispose();
    }

    // ── Public operations ──────────────────────────────────────────────────────

    /** Ensure the data dir is a git repo with origin set.  Returns false on failure. */
    async setup(opts: SyncOptions = {}): Promise<boolean> {
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

            // 7. If remote has commits, integrate them (auto-merging conflicts)
            if (await git.remoteHasCommits(this.dir, url, pat)) {
                const merged = await this._integrateRemote(url, pat, opts);
                if (!merged) { return false; }
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

    /**
     * Pull remote changes.  Local commits are preserved (the remote is merged
     * in), JSON store conflicts auto-merge semantically, and anything left
     * over goes through the conflict resolver UI.
     */
    async pull(opts: SyncOptions = {}): Promise<boolean> {
        return this._run('Pulling…', async (url, pat) => {
            // Local edits must be committed before a merge can run safely.
            if (await git.hasChanges(this.dir)) {
                await git.gitAdd(this.dir);
                await git.gitCommit(this.dir, this._autoMessage());
            }
            if (!(await this._integrateRemote(url, pat, opts))) { return false; }
            this._setState({
                status: 'idle',
                message: 'Pulled successfully.',
                lastSync: new Date().toISOString(),
            });
            return true;
        });
    }

    /** Full sync: commit local changes → integrate remote → push (with retry). */
    async fullSync(opts: SyncOptions = {}): Promise<boolean> {
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

            // 2. Integrate remote (merge + auto-resolve), 3. push — retried
            // once when another machine pushes between our merge and push.
            if (!(await this._syncAndPush(url, pat, opts))) { return false; }

            this._setState({
                status: 'idle',
                message: 'Synced successfully.',
                lastSync: new Date().toISOString(),
            });
            return true;
        });
    }

    // ── Remote integration (merge + conflict resolution) ──────────────────────

    /** Integrate + push with retry on push races.  Expects a clean worktree. */
    private async _syncAndPush(url: string, pat: string, opts: SyncOptions): Promise<boolean> {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (!(await this._integrateRemote(url, pat, opts))) { return false; }

            if (!(await git.remoteHasCommits(this.dir, url, pat)) || (await git.aheadCount(this.dir)) > 0) {
                const push = await git.gitPush(this.dir, url, pat);
                if (push.code === 0) { return true; }
                const raced = /fetch first|non-fast-forward|rejected/i.test(push.stderr);
                if (!raced || attempt === 2) {
                    this._fail('Push failed: ' + push.stderr);
                    return false;
                }
                this._log.appendLine('[sync] Push raced with another machine — re-integrating…');
                continue;
            }
            return true;  // nothing to push
        }
        return false;
    }

    /**
     * Bring `origin/main` into the local branch.
     *
     *   - clean worktree assumed (callers commit first)
     *   - fast-forwards when possible,
     *   - merges otherwise,
     *   - conflicted data stores merge semantically (see data-merge.ts),
     *   - leftovers go to the resolver UI (interactive) or back off with a
     *     "Resolve…" notification (auto-sync).
     */
    private async _integrateRemote(url: string, pat: string, opts: SyncOptions): Promise<boolean> {
        // Recover from a merge a previous crash left behind.
        if (await git.isMergeInProgress(this.dir)) {
            this._log.appendLine('[sync] Aborting stale in-progress merge.');
            await git.gitMergeAbort(this.dir);
        }

        if (!(await git.remoteHasCommits(this.dir, url, pat))) { return true; }

        const fetch = await git.gitFetchMain(this.dir, url, pat);
        if (fetch.code !== 0) {
            this._fail('Fetch failed: ' + fetch.stderr);
            return false;
        }

        const behind = await git.behindCount(this.dir);
        if (behind === 0) { return true; }

        const ahead = await git.aheadCount(this.dir);
        if (ahead === 0) {
            const ff = await git.gitMergeFfOnly(this.dir, 'origin/main');
            if (ff.code !== 0) {
                this._fail('Pull failed: ' + ff.stderr);
                return false;
            }
            return true;
        }

        // Both sides moved — merge.
        this._log.appendLine(`[sync] Diverged (ahead ${ahead}, behind ${behind}) — merging origin/main.`);
        const merge = await git.gitMerge(this.dir, 'origin/main');
        if (merge.code === 0) { return true; }

        const conflicted = await git.listConflictedFiles(this.dir);
        if (conflicted.length === 0) {
            // Merge failed for a non-conflict reason.
            await git.gitMergeAbort(this.dir);
            this._fail('Merge failed: ' + (merge.stderr || merge.stdout));
            return false;
        }

        // Pass 1: semantic auto-merge of known data stores.
        const remaining = await this._autoResolveConflicts(conflicted);

        // Pass 2: interactive resolution (or back off for auto-sync).
        if (remaining.length > 0) {
            if (!isInteractive(opts) || !this._resolver) {
                await git.gitMergeAbort(this.dir);
                this._enterConflictState(remaining);
                return false;
            }
            const resolved = await this._resolveInteractively(remaining);
            if (!resolved) {
                await git.gitMergeAbort(this.dir);
                this._setState({ status: 'idle', message: 'Sync cancelled — no changes applied.' });
                return false;
            }
        }

        const commit = await git.gitCommitMerge(this.dir, this._autoMessage() + ' (merge)');
        if (commit.code !== 0) {
            await git.gitMergeAbort(this.dir);
            this._fail('Could not finish the merge: ' + commit.stderr);
            return false;
        }
        this._log.appendLine('[sync] Merge completed.');
        return true;
    }

    /** Try the semantic merger on every conflicted file; returns the leftovers. */
    private async _autoResolveConflicts(conflicted: string[]): Promise<ConflictFile[]> {
        const remaining: ConflictFile[] = [];

        for (const file of conflicted) {
            const [base, ours, theirs] = await Promise.all([
                git.getStageContent(this.dir, file, 1),
                git.getStageContent(this.dir, file, 2),
                git.getStageContent(this.dir, file, 3),
            ]);

            // Modify/delete conflicts: the edited side wins (matches the
            // item-level "edit beats delete" rule).
            if (ours === undefined || theirs === undefined) {
                const survivor = ours ?? theirs;
                if (survivor !== undefined) {
                    fs.mkdirSync(path.dirname(path.join(this.dir, file)), { recursive: true });
                    fs.writeFileSync(path.join(this.dir, file), survivor, 'utf-8');
                }
                await git.stageFile(this.dir, file);
                this._log.appendLine(`[sync] Auto-resolved (edit beats delete): ${file}`);
                continue;
            }

            const merged = mergeStoreFile(file, base, ours, theirs);
            if (merged) {
                fs.writeFileSync(path.join(this.dir, file), merged.text, 'utf-8');
                await git.stageFile(this.dir, file);
                this._log.appendLine(
                    `[sync] Auto-merged ${file}` +
                    (merged.softConflicts > 0
                        ? ` (${merged.softConflicts} double edit(s) resolved by newest change)`
                        : ''),
                );
                continue;
            }

            remaining.push({ path: file, label: friendlyStoreName(file), base, ours, theirs });
        }

        return remaining;
    }

    /** Hand the leftovers to the resolver UI and apply the user's choices. */
    private async _resolveInteractively(files: ConflictFile[]): Promise<boolean> {
        this._setState({ status: 'conflict', message: 'Waiting for conflict resolution…' });
        const choices = await this._resolver!(files);
        if (!choices) { return false; }

        for (const file of files) {
            const side = choices.get(file.path) ?? 'ours';
            await git.takeConflictSide(this.dir, file.path, side);
            this._log.appendLine(`[sync] Resolved ${file.path} → ${side === 'ours' ? 'local' : 'remote'}`);
        }
        this._setState({ status: 'syncing', message: 'Finishing merge…' });
        return true;
    }

    /** Auto-sync hit unresolvable conflicts: notify with a resolve action. */
    private _enterConflictState(files: ConflictFile[]): void {
        const names = files.slice(0, 3).map(f => f.label).join(', ')
            + (files.length > 3 ? ` and ${files.length - 3} more` : '');
        this._setState({
            status: 'conflict',
            message: `Sync conflict in ${names}. Run "Resolve Conflicts" to choose a version.`,
        });
        void vscode.window.showWarningMessage(
            `Tulcase Sync: conflicting changes in ${names}.`,
            'Resolve Conflicts',
        ).then(pick => {
            if (pick === 'Resolve Conflicts') {
                void vscode.commands.executeCommand('tulcase.sync.resolveConflicts');
            }
        });
    }

    /**
     * Discard all local data and replace it with the remote repository contents.
     * Wipes the data directory and does a fresh `git clone`.
     */
    async resetToRemote(): Promise<boolean> {
        return this._run('Resetting to remote…', async (url, pat) => {
            this._log.appendLine(`[resetToRemote] Starting — dir=${this.dir}`);
            this._log.appendLine(`[resetToRemote] Remote URL: ${url}`);

            // 1. Ensure git is available
            if (!(await git.gitAvailable())) {
                this._fail('Git is not installed or not on PATH.');
                return false;
            }
            this._log.appendLine('[resetToRemote] git is available');

            // 2. Wipe the data directory completely
            if (fs.existsSync(this.dir)) {
                fs.rmSync(this.dir, { recursive: true, force: true });
                this._log.appendLine('[resetToRemote] Wiped data directory');
            }

            // 3. Clone the remote repo directly into the data dir
            const authUrl = git.authenticatedUrl(url, pat);
            this._log.appendLine(`[resetToRemote] Cloning into ${this.dir}…`);
            const clone = await git.gitClone(authUrl, this.dir);
            this._log.appendLine(`[resetToRemote] Clone exit code: ${clone.code}`);
            if (clone.stdout) { this._log.appendLine(`[resetToRemote] Clone stdout: ${clone.stdout.trim()}`); }
            if (clone.stderr) { this._log.appendLine(`[resetToRemote] Clone stderr: ${clone.stderr.trim()}`); }

            if (clone.code !== 0) {
                // Ensure dir exists even on failure so the extension doesn't crash
                fs.mkdirSync(this.dir, { recursive: true });
                this._fail('Clone failed: ' + clone.stderr);
                return false;
            }

            // 4. Verify the clone actually produced data
            const dataDir = path.join(this.dir, DATABASES_ROOT);
            if (!fs.existsSync(dataDir)) {
                this._log.appendLine('[resetToRemote] ERROR: data/ directory missing after clone!');
                this._fail('Clone succeeded but no data was downloaded. Check the repository contents.');
                return false;
            }
            const databases = fs.readdirSync(dataDir).filter(
                d => fs.statSync(path.join(dataDir, d)).isDirectory(),
            );
            this._log.appendLine(`[resetToRemote] Databases found: ${databases.join(', ') || '(none)'}`);
            if (databases.length === 0) {
                this._fail('Clone succeeded but the repository contains no databases.');
                return false;
            }

            // 5. Restore .active-database marker (gitignored, so not in the clone)
            const currentActive = this.settings.activeDb;
            const activeDb = databases.includes(currentActive) ? currentActive : databases[0];
            writeActiveDb(this.dir, activeDb);
            this._log.appendLine(`[resetToRemote] Active database set to: ${activeDb}`);

            // 6. Update in-memory settings so providers read from the right paths
            if (activeDb !== currentActive) {
                const { buildSettings } = await import('../config');
                const fresh = buildSettings(this.dir, activeDb);
                Object.assign(this.settings, fresh);
                this._log.appendLine(`[resetToRemote] Settings switched from '${currentActive}' → '${activeDb}'`);
            }

            // 7. Strip credentials from stored remote URL
            await git.setRemoteUrl(this.dir, url);

            // 8. Configure git user
            await git.configureUser(this.dir, 'Tulcase', 'tulcase@sync');

            // 9. Write .gitignore
            this._ensureGitignore();

            this._log.appendLine('[resetToRemote] Complete — showing output channel');
            this._log.show(true);

            vscode.window.showInformationMessage(
                `Tulcase reset complete — loaded ${databases.length} database(s): ${databases.join(', ')}. Active: ${activeDb}`,
            );

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

        if (await git.isMergeInProgress(this.dir)) {
            this._setState({
                status: 'conflict',
                message: 'A merge is in progress. Run "Resolve Conflicts" to choose a version.',
            });
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
            this._log.appendLine(`[_run] Config missing — url=${url ? 'set' : 'EMPTY'}, pat=${pat ? 'set' : 'EMPTY'}`);
            vscode.window.showErrorMessage('Tulcase Sync: Repository URL or access token is not configured. Run the setup wizard.');
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

function isInteractive(opts: SyncOptions): boolean {
    return opts.interactive !== false;
}

function friendlyStoreName(file: string): string {
    const normalized = file.replace(/\\/g, '/');
    const parts = normalized.split('/');
    const dataIndex = parts.indexOf(DATABASES_ROOT);
    const database = dataIndex >= 0 ? parts[dataIndex + 1] : undefined;
    const store = dataIndex >= 0 ? parts[dataIndex + 2] : undefined;

    // Per-script .sh files: disambiguate by filename so multiple conflicting
    // scripts are distinguishable in the resolver list.
    if (store === 'scripts_db' && parts[dataIndex + 3] === 'files') {
        const label = `Script file "${path.basename(normalized)}"`;
        return database ? `${label} - database "${database}"` : label;
    }

    const label = storeName(store, path.basename(normalized));
    return database ? `${label} - database "${database}"` : label;
}

function storeName(store: string | undefined, fallback: string): string {
    switch (store) {
        case 'todo_db': return 'Todos';
        case 'commands_db': return 'Commands';
        case 'scripts_db': return 'Scripts';
        case 'lists_db': return 'Notes';
        case 'links_db': return 'Links';
        case 'tags_db': return 'Tags';
        case 'records_db': return 'Records';
        case 'pipe_db': return 'Pipe scopes';
        default: return fallback || 'Data file';
    }
}

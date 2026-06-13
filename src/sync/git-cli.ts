/**
 * Low-level Git CLI wrapper.
 *
 * All functions shell out to the local `git` binary via `child_process.execFile`
 * (no shell — safe from injection).  PATs are injected into HTTPS URLs at
 * call-time and never written to the git config.
 */
import { execFile } from 'child_process';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GitResult {
    stdout: string;
    stderr: string;
    code: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Run a git command in `cwd` and return the result. Never throws. */
function run(cwd: string, args: string[], env?: Record<string, string>): Promise<GitResult> {
    return new Promise(resolve => {
        const merged = { ...process.env, ...env };
        execFile('git', args, { cwd, env: merged, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (!err) {
                resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: 0 });
                return;
            }
            // ENOENT → git binary not found
            const nodeErr = err as NodeJS.ErrnoException;
            if (nodeErr.code === 'ENOENT') {
                resolve({ stdout: '', stderr: 'git not found', code: -1 });
                return;
            }
            // Non-zero exit from git
            const exitCode = (err as unknown as { status?: number }).status ?? 1;
            resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: exitCode });
        });
    });
}

/** Inject a PAT into an HTTPS URL: `https://host/repo` → `https://token:PAT@host/repo`. */
export function authenticatedUrl(baseUrl: string, pat: string): string {
    try {
        const u = new URL(baseUrl);
        u.username = 'token';
        u.password = pat;
        return u.toString();
    } catch {
        return baseUrl;  // Malformed URL — return as-is
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Check whether `git` is available on PATH. */
export async function gitAvailable(): Promise<boolean> {
    const r = await run('.', ['--version']);
    return r.code === 0;
}

/** Check whether `dir` is inside a git repository. */
export async function isGitRepo(dir: string): Promise<boolean> {
    const r = await run(dir, ['rev-parse', '--is-inside-work-tree']);
    return r.code === 0 && r.stdout.trim() === 'true';
}

/** `git init` a new repository. */
export async function gitInit(dir: string): Promise<GitResult> {
    return run(dir, ['init', '-b', 'main']);
}

/** Get the current remote URL for `origin`, or `undefined`. */
export async function getRemoteUrl(dir: string): Promise<string | undefined> {
    const r = await run(dir, ['remote', 'get-url', 'origin']);
    return r.code === 0 ? r.stdout.trim() : undefined;
}

/** Set (or add) the remote `origin` URL.  Strips credentials before storing. */
export async function setRemoteUrl(dir: string, url: string): Promise<GitResult> {
    const existing = await getRemoteUrl(dir);
    if (existing) {
        return run(dir, ['remote', 'set-url', 'origin', url]);
    }
    return run(dir, ['remote', 'add', 'origin', url]);
}

/** `git add -A` — stage everything, then purge any backslash-path index entries. */
export async function gitAdd(dir: string): Promise<GitResult> {
    const r = await run(dir, ['add', '-A']);
    if (r.code !== 0) { return r; }

    // Safety: remove index entries whose path contains a literal backslash.
    // These are phantom duplicates caused by Windows path separators leaking
    // into the git tree on some git versions / configurations.
    const ls = await run(dir, ['ls-files']);
    if (ls.code === 0) {
        const bad = ls.stdout.split('\n').filter(f => f.includes('\\'));
        for (const f of bad) {
            await run(dir, ['rm', '--cached', '--', f]);
        }
    }
    return r;
}

/** `git commit -m <message>`.  Returns code 1 if nothing to commit. */
export async function gitCommit(dir: string, message: string): Promise<GitResult> {
    return run(dir, ['commit', '-m', message]);
}

/** Check if there are uncommitted changes (staged or unstaged). */
export async function hasChanges(dir: string): Promise<boolean> {
    const r = await run(dir, ['status', '--porcelain']);
    return r.code === 0 && r.stdout.trim().length > 0;
}

/** Get the short status summary (one line per changed file). */
export async function gitStatus(dir: string): Promise<string> {
    const r = await run(dir, ['status', '--short']);
    return r.stdout.trim();
}

/** `git push` to origin using an authenticated URL (PAT never stored). */
export async function gitPush(dir: string, remoteUrl: string, pat: string): Promise<GitResult> {
    const url = authenticatedUrl(remoteUrl, pat);
    return run(dir, ['push', url, 'main']);
}

/** `git pull --ff-only` from origin using an authenticated URL. */
export async function gitPull(dir: string, remoteUrl: string, pat: string): Promise<GitResult> {
    const url = authenticatedUrl(remoteUrl, pat);
    return run(dir, ['pull', '--ff-only', url, 'main']);
}

/** Remove stale rebase-merge / rebase-apply directories so a fresh pull can proceed. */
export async function cleanRebaseState(dir: string): Promise<void> {
    await run(dir, ['rebase', '--abort']).catch(() => {});
    // Belt-and-suspenders: remove leftover dirs that confuse git
    const { join } = await import('path');
    const { rmSync } = await import('fs');
    for (const sub of ['rebase-merge', 'rebase-apply']) {
        try { rmSync(join(dir, '.git', sub), { recursive: true, force: true }); } catch { /* ok */ }
    }
}

/** `git pull --rebase` from origin.  Cleans stale rebase state first, aborts on conflict. */
export async function gitPullRebase(dir: string, remoteUrl: string, pat: string): Promise<GitResult> {
    await cleanRebaseState(dir);
    const url = authenticatedUrl(remoteUrl, pat);
    const r = await run(dir, ['pull', '--rebase', url, 'main']);
    if (r.code !== 0 && r.stderr.includes('CONFLICT')) {
        await run(dir, ['rebase', '--abort']);
    }
    return r;
}

/** Hard-reset the working tree to a given ref (e.g. 'origin/main'). */
export async function gitResetHard(dir: string, ref: string): Promise<GitResult> {
    return run(dir, ['reset', '--hard', ref]);
}

/** Remove untracked files and directories. */
export async function gitClean(dir: string): Promise<GitResult> {
    return run(dir, ['clean', '-fd']);
}

/** `git fetch` from origin using an authenticated URL. */
export async function gitFetch(dir: string, remoteUrl: string, pat: string): Promise<GitResult> {
    const url = authenticatedUrl(remoteUrl, pat);
    return run(dir, ['fetch', url]);
}

/**
 * Fetch the remote `main` into the `origin/main` tracking ref.
 * (A plain `git fetch <url>` only updates FETCH_HEAD — the tracking ref the
 * merge/ahead-behind logic relies on would stay stale.)
 */
export async function gitFetchMain(dir: string, remoteUrl: string, pat: string): Promise<GitResult> {
    const url = authenticatedUrl(remoteUrl, pat);
    return run(dir, ['fetch', url, '+main:refs/remotes/origin/main']);
}

/** Commits on `origin/main` that HEAD doesn't have (how far we are behind). */
export async function behindCount(dir: string): Promise<number> {
    const r = await run(dir, ['rev-list', '--count', 'HEAD..origin/main']);
    return r.code === 0 ? Number(r.stdout.trim()) || 0 : 0;
}

/** Commits on HEAD that `origin/main` doesn't have (how far we are ahead). */
export async function aheadCount(dir: string): Promise<number> {
    const r = await run(dir, ['rev-list', '--count', 'origin/main..HEAD']);
    return r.code === 0 ? Number(r.stdout.trim()) || 0 : 0;
}

/** `git merge <ref> --no-edit` — does NOT auto-abort on conflict. */
export async function gitMerge(dir: string, ref: string): Promise<GitResult> {
    return run(dir, ['merge', '--no-edit', ref]);
}

/** `git merge --ff-only <ref>`. */
export async function gitMergeFfOnly(dir: string, ref: string): Promise<GitResult> {
    return run(dir, ['merge', '--ff-only', ref]);
}

/** Abort an in-progress merge (best effort). */
export async function gitMergeAbort(dir: string): Promise<GitResult> {
    return run(dir, ['merge', '--abort']);
}

/** Whether a merge is currently in progress (MERGE_HEAD exists). */
export async function isMergeInProgress(dir: string): Promise<boolean> {
    const r = await run(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
    return r.code === 0;
}

/** Repo-relative paths of files with unresolved merge conflicts. */
export async function listConflictedFiles(dir: string): Promise<string[]> {
    const r = await run(dir, ['diff', '--name-only', '--diff-filter=U']);
    if (r.code !== 0) { return []; }
    return r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * Content of one side of a conflicted file from the index.
 * Stage 1 = common ancestor, 2 = ours (local), 3 = theirs (remote).
 * Returns undefined when that stage doesn't exist (e.g. add/add has no base).
 */
export async function getStageContent(
    dir: string,
    file: string,
    stage: 1 | 2 | 3,
): Promise<string | undefined> {
    const r = await run(dir, ['show', `:${stage}:${file}`]);
    return r.code === 0 ? r.stdout : undefined;
}

/** Stage a single file (marks its conflict as resolved). */
export async function stageFile(dir: string, file: string): Promise<GitResult> {
    return run(dir, ['add', '--', file]);
}

/** Resolve a conflicted file by taking one side wholesale, then stage it. */
export async function takeConflictSide(
    dir: string,
    file: string,
    side: 'ours' | 'theirs',
): Promise<GitResult> {
    const co = await run(dir, ['checkout', side === 'ours' ? '--ours' : '--theirs', '--', file]);
    if (co.code !== 0) { return co; }
    return stageFile(dir, file);
}

/** Conclude an in-progress merge with a commit (after all conflicts staged). */
export async function gitCommitMerge(dir: string, message: string): Promise<GitResult> {
    return run(dir, ['commit', '--no-edit', '-m', message]);
}

/** Get the timestamp of the last commit (ISO format), or undefined. */
export async function lastCommitTime(dir: string): Promise<string | undefined> {
    const r = await run(dir, ['log', '-1', '--format=%cI']);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : undefined;
}

/** Check whether the remote branch exists (has any commits). */
export async function remoteHasCommits(dir: string, remoteUrl: string, pat: string): Promise<boolean> {
    const url = authenticatedUrl(remoteUrl, pat);
    const r = await run(dir, ['ls-remote', '--heads', url, 'main']);
    return r.code === 0 && r.stdout.trim().length > 0;
}

/** Check if there are local commits not yet pushed. */
export async function hasUnpushed(dir: string): Promise<boolean> {
    const r = await run(dir, ['log', 'origin/main..HEAD', '--oneline']);
    return r.code === 0 && r.stdout.trim().length > 0;
}

/** Configure git user for commits (required for git commit to work). */
export async function configureUser(dir: string, name: string, email: string): Promise<void> {
    await run(dir, ['config', 'user.name', name]);
    await run(dir, ['config', 'user.email', email]);
    // Relax path validation so Windows-committed backslash paths work on Linux
    await run(dir, ['config', 'core.protectNTFS', 'false']);
    await run(dir, ['config', 'core.protectHFS', 'false']);
}

/**
 * Clone a remote repo into `dir`.
 * `dir` must not exist or must be empty.  Uses `-c` flags to relax
 * path validation so Windows-committed backslash paths don't break Linux.
 */
export async function gitClone(authUrl: string, dir: string): Promise<GitResult> {
    return run('.', [
        'clone',
        '-c', 'core.protectNTFS=false',
        '-c', 'core.protectHFS=false',
        authUrl,
        dir,
    ]);
}

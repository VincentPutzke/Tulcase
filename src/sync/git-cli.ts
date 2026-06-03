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
            const code = err ? (err as NodeJS.ErrnoException & { code?: number | string }).code === 'ENOENT' ? -1 : (err as { code?: number }).code ?? 1 : 0;
            resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', code: typeof code === 'number' ? code : 1 });
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

/** `git add -A` — stage everything. */
export async function gitAdd(dir: string): Promise<GitResult> {
    return run(dir, ['add', '-A']);
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

/** `git pull --rebase` from origin.  Aborts the rebase on conflict. */
export async function gitPullRebase(dir: string, remoteUrl: string, pat: string): Promise<GitResult> {
    const url = authenticatedUrl(remoteUrl, pat);
    const r = await run(dir, ['pull', '--rebase', url, 'main']);
    if (r.code !== 0 && r.stderr.includes('CONFLICT')) {
        await run(dir, ['rebase', '--abort']);
    }
    return r;
}

/** `git fetch` from origin using an authenticated URL. */
export async function gitFetch(dir: string, remoteUrl: string, pat: string): Promise<GitResult> {
    const url = authenticatedUrl(remoteUrl, pat);
    return run(dir, ['fetch', url]);
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
}

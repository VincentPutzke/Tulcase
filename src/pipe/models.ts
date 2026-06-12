/**
 * GitLab pipeline / job domain models for the Tulcase Pipe feature.
 * Mirrors the subset of the GitLab REST API responses we render or reason
 * about, plus the Tulcase-managed scope model.
 */

/** Statuses GitLab can report for a pipeline or job. */
export type GitLabStatus =
    | 'created'
    | 'waiting_for_resource'
    | 'preparing'
    | 'pending'
    | 'running'
    | 'success'
    | 'failed'
    | 'canceled'
    | 'skipped'
    | 'manual'
    | 'scheduled';

/** All valid status values (used for validation and UI pickers). */
export const ALL_STATUSES: ReadonlyArray<GitLabStatus> = [
    'created', 'waiting_for_resource', 'preparing', 'pending', 'running',
    'success', 'failed', 'canceled', 'skipped', 'manual', 'scheduled',
];

/** Terminal statuses — polling for a job log stops (after one final flush). */
export const TERMINAL_STATUSES: ReadonlyArray<GitLabStatus> = [
    'success', 'failed', 'canceled', 'skipped',
];

/** Statuses during which a pipeline / job can still be canceled. */
export const ACTIVE_STATUSES: ReadonlyArray<GitLabStatus> = [
    'created', 'waiting_for_resource', 'preparing', 'pending', 'running',
];

/**
 * A configured "scope" of pipelines to fetch and display.
 *
 * Scopes are first-class Tulcase data: stored in the active database
 * (`pipe_db/scopes.json`), synced via Git Sync, taggable, and editable
 * through the Pipe Scopes view — no hand-written JSON required.
 */
export interface PipeScope {
    /** Stable generated id (survives renames and reorders). */
    id: string;
    /** Display label. */
    label: string;
    /** Project path-with-namespace (`group/project`) or numeric id. */
    projects: string[];
    /** Disabled scopes are kept but not polled or rendered. */
    enabled: boolean;
    /** Followed scopes raise a VS Code notification when a pipeline finishes. */
    follow: boolean;
    /** Tulcase tag names attached to this scope. */
    tags: string[];
    /** Filter to pipelines on this branch (exact match, case-insensitive). */
    branchFilter?: string;
    /** Allowed pipeline statuses. */
    statusFilter?: GitLabStatus[];
    /** Filter to pipelines triggered by this username. */
    userFilter?: string;
    /** Case-insensitive substring filter on pipeline ref / commit sha. */
    nameContains?: string;
    /** Only show pipelines updated in the last N hours. */
    sinceHours?: number;
    /** Keep only the most recent N pipelines. */
    lastN?: number;
    /** Ordered list of log-rule names applied to job logs in this scope. */
    logRules?: string[];
}

/** A pipeline as exposed in the webview / store. */
export interface Pipeline {
    id: number;
    iid?: number;
    projectId: number | string;
    projectPath: string;
    ref: string;
    sha: string;
    status: GitLabStatus;
    source?: string;
    webUrl: string;
    createdAt: string;
    updatedAt: string;
    user?: { username: string; name?: string };
    jobs: Job[];
}

/** A job inside a pipeline. */
export interface Job {
    id: number;
    name: string;
    stage: string;
    status: GitLabStatus;
    ref: string;
    webUrl: string;
    startedAt?: string;
    finishedAt?: string;
    duration?: number;
    pipelineId: number;
    projectId: number | string;
    projectPath: string;
    hasArtifacts?: boolean;
    allowFailure?: boolean;
    manualPlayable?: boolean;
    /** True for bridge / trigger jobs (no trace available). */
    isBridge?: boolean;
    /** URL of the downstream pipeline spawned by a bridge job. */
    downstreamUrl?: string;
    /** Downstream pipeline ID for fetching child jobs. */
    downstreamPipelineId?: number;
    /** Downstream project ID (defaults to same project for child pipelines). */
    downstreamProjectId?: number | string;
    /** Jobs from the downstream pipeline (populated recursively). */
    children?: Job[];
}

// ── Scope normalisation ───────────────────────────────────────────────────────

/**
 * Coerce an untyped object (from disk or import) into a valid `PipeScope`.
 * Returns `undefined` when the entry has no usable project list.
 * Unknown fields are dropped; wrong-typed fields fall back to defaults.
 */
export function normalizeScope(raw: unknown, fallbackId: string): PipeScope | undefined {
    if (!raw || typeof raw !== 'object') { return undefined; }
    const r = raw as Record<string, unknown>;

    const projects = Array.isArray(r.projects)
        ? r.projects.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
            .map(p => p.trim())
        : [];
    if (projects.length === 0) { return undefined; }

    const scope: PipeScope = {
        id: typeof r.id === 'string' && r.id.trim() ? r.id : fallbackId,
        label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : projects[0],
        projects,
        enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
        follow: typeof r.follow === 'boolean' ? r.follow : false,
        tags: Array.isArray(r.tags)
            ? r.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
            : [],
    };

    if (typeof r.branchFilter === 'string' && r.branchFilter.trim()) {
        scope.branchFilter = r.branchFilter.trim();
    }
    if (Array.isArray(r.statusFilter)) {
        const statuses = r.statusFilter.filter(
            (s): s is GitLabStatus => typeof s === 'string' && (ALL_STATUSES as string[]).includes(s),
        );
        if (statuses.length > 0) { scope.statusFilter = statuses; }
    }
    if (typeof r.userFilter === 'string' && r.userFilter.trim()) {
        scope.userFilter = r.userFilter.trim();
    }
    if (typeof r.nameContains === 'string' && r.nameContains.trim()) {
        scope.nameContains = r.nameContains.trim();
    }
    if (typeof r.sinceHours === 'number' && r.sinceHours > 0) {
        scope.sinceHours = r.sinceHours;
    }
    if (typeof r.lastN === 'number' && r.lastN > 0) {
        scope.lastN = Math.floor(r.lastN);
    }
    if (Array.isArray(r.logRules)) {
        const rules = r.logRules.filter((n): n is string => typeof n === 'string' && n.length > 0);
        if (rules.length > 0) { scope.logRules = rules; }
    }
    return scope;
}

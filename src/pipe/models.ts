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

/** Current on-disk schema version for the scopes file. */
export const SCOPE_SCHEMA_VERSION = 2;

/**
 * One target of a scope: a GitLab project or a GitLab group.
 *
 * A `group` source expands recursively into all its subgroups/projects (shown
 * as folders in the Registry, polled by Pipe), minus its `exclude` paths.
 */
export interface PipeSource {
    type: 'project' | 'group';
    /** Project/group path-with-namespace (`group/project`) or numeric id. */
    ref: string;
    /**
     * Full paths (subgroups or projects) dropped from a `group` source — the
     * excluded path *and its whole subtree* (prefix match), in both Pipe and
     * Registry. Only meaningful when `type === 'group'`.
     */
    exclude?: string[];
}

/**
 * A configured "scope" of GitLab projects/groups, shared by the Pipe
 * (pipelines) and Registry (packages) sub-views.
 *
 * Scopes are first-class Tulcase data: stored in the active database
 * (`pipe_db/scopes.json`), synced via Git Sync, taggable, and editable
 * through the Scopes view — no hand-written JSON required.
 *
 * Schema v2 (see ADR-0001): `sources[]` replaces the old flat `projects[]`,
 * and the single `enabled` flag splits into independent `pipeEnabled` /
 * `registryEnabled`. `projects` and `enabled` are retained as **compatibility
 * shadows** — always kept in sync (dual-written to disk) so older extension
 * builds reading the same synced file don't drop the scope.
 */
export interface PipeScope {
    /** Stable generated id (survives renames and reorders). */
    id: string;
    /** Display label. */
    label: string;
    /** Targets driving this scope (projects and/or groups). */
    sources: PipeSource[];
    /** Whether this scope feeds the Pipe (pipelines) view. */
    pipeEnabled: boolean;
    /** Whether this scope feeds the Registry (packages) view. */
    registryEnabled: boolean;
    /** ISO timestamp of the last write; used as the sync-merge tiebreak. */
    updatedAt: string;
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

    // ── Compatibility shadows (dual-written, always kept in sync) ─────────────
    /** @deprecated shadow of the project refs in `sources`; read `sources`. */
    projects: string[];
    /** @deprecated shadow of `pipeEnabled`; read `pipeEnabled`. */
    enabled: boolean;
}

/** Project refs (path/id) drawn from a scope's `project` sources. */
export function scopeProjectRefs(scope: PipeScope): string[] {
    return scope.sources.filter(s => s.type === 'project').map(s => s.ref);
}

/** Group sources of a scope. */
export function scopeGroupSources(scope: PipeScope): PipeSource[] {
    return scope.sources.filter(s => s.type === 'group');
}

/** Re-derive the compatibility shadows (`projects`, `enabled`) from v2 fields. */
export function syncScopeShadows(scope: PipeScope): PipeScope {
    scope.projects = scopeProjectRefs(scope);
    scope.enabled = scope.pipeEnabled;
    return scope;
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
 * Coerce an untyped object (from disk or import) into a valid `PipeSource`.
 * Returns `undefined` when the entry has no usable `ref`.
 */
export function normalizeSource(raw: unknown): PipeSource | undefined {
    if (!raw || typeof raw !== 'object') { return undefined; }
    const r = raw as Record<string, unknown>;
    const ref = typeof r.ref === 'string' ? r.ref.trim() : '';
    if (!ref) { return undefined; }
    const source: PipeSource = { type: r.type === 'group' ? 'group' : 'project', ref };
    if (source.type === 'group' && Array.isArray(r.exclude)) {
        const exclude = r.exclude
            .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
            .map(e => e.trim());
        if (exclude.length > 0) { source.exclude = exclude; }
    }
    return source;
}

/**
 * Coerce an untyped object (from disk or import) into a valid `PipeScope`.
 * Reads BOTH the v2 shape (`sources`) and the legacy v1 shape (`projects`),
 * so upgrading is transparent. Returns `undefined` when the entry has no
 * usable source. Unknown fields are dropped; wrong-typed fields fall back to
 * defaults. The compatibility shadows (`projects`, `enabled`) are always set.
 */
export function normalizeScope(raw: unknown, fallbackId: string): PipeScope | undefined {
    if (!raw || typeof raw !== 'object') { return undefined; }
    const r = raw as Record<string, unknown>;

    // v2 `sources` first; fall back to migrating legacy `projects`.
    let sources: PipeSource[] = Array.isArray(r.sources)
        ? r.sources.map(normalizeSource).filter((s): s is PipeSource => s !== undefined)
        : [];
    if (sources.length === 0 && Array.isArray(r.projects)) {
        sources = r.projects
            .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
            .map(p => ({ type: 'project' as const, ref: p.trim() }));
    }
    if (sources.length === 0) { return undefined; }

    // pipeEnabled falls back to the legacy `enabled`; registryEnabled defaults
    // off on migration so existing scopes don't start hitting the registry.
    const pipeEnabled = typeof r.pipeEnabled === 'boolean' ? r.pipeEnabled
        : typeof r.enabled === 'boolean' ? r.enabled
        : true;

    const scope: PipeScope = {
        id: typeof r.id === 'string' && r.id.trim() ? r.id : fallbackId,
        label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : sources[0].ref,
        sources,
        pipeEnabled,
        registryEnabled: typeof r.registryEnabled === 'boolean' ? r.registryEnabled : false,
        updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : '',
        follow: typeof r.follow === 'boolean' ? r.follow : false,
        tags: Array.isArray(r.tags)
            ? r.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
            : [],
        // Shadows filled by syncScopeShadows() below.
        projects: [],
        enabled: pipeEnabled,
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
    return syncScopeShadows(scope);
}

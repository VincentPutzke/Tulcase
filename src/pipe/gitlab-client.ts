/**
 * GitLab REST API client for the Tulcase Pipe feature.
 *
 * Read paths (pipelines, jobs, bridges, traces, artifacts) plus the write
 * actions that drive pipelines from inside VS Code:
 *
 *   - `createPipeline()` — trigger a new pipeline with variables and inputs,
 *   - `retryPipeline()` / `cancelPipeline()`,
 *   - `retryJob()` / `cancelJob()` / `playJob()` (manual jobs),
 *   - `listBranches()` / `searchProjects()` for pickers.
 *
 * Robustness:
 *   - Every request can be aborted via `AbortSignal`.
 *   - `429 Too Many Requests` is retried up to N times honouring `Retry-After`.
 *   - When a `Range` request is silently ignored by the server (status 200
 *     with offset > 0), the caller is told to *replace* its buffer.
 */

import type { Pipeline, Job, GitLabStatus } from './models';
import { Semaphore } from './concurrency';

export class GitLabApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly url: string,
        public readonly body?: string,
    ) {
        super(message);
        this.name = 'GitLabApiError';
    }
}

export interface AuthProvider {
    baseUrl(): string;
    getToken(): Promise<string | undefined>;
}

export interface ListPipelinesParams {
    perPage?: number;
    page?: number;
    ref?: string;
    status?: GitLabStatus;
    username?: string;
    updatedAfter?: string;
}

export interface JobTraceChunk {
    /** New text bytes appended since `offset`. */
    text: string;
    /** Total byte length of the trace after this chunk. */
    nextOffset: number;
    /** True when the server reports no more bytes will arrive. */
    complete: boolean;
    /**
     * If the server ignored our `Range` header and returned the full body,
     * the caller should *replace* its buffer with `text` rather than append.
     */
    replace?: boolean;
}

/** A CI/CD variable passed when triggering a pipeline. */
export interface PipelineVariable {
    key: string;
    value: string;
    variableType?: 'env_var' | 'file';
}

/** A project search hit (for the scope editor's project picker). */
export interface ProjectHit {
    id: number;
    pathWithNamespace: string;
    description?: string;
}

/** A branch (for the run-pipeline ref picker). */
export interface BranchHit {
    name: string;
    default: boolean;
}

/** A group search hit / enumerated subgroup (for the Registry + scope editor). */
export interface GroupHit {
    id: number;
    fullPath: string;
    name: string;
}

/** A project enumerated under a group (Registry folder tree / Pipe expansion). */
export interface ProjectNode {
    id: number;
    pathWithNamespace: string;
    name: string;
}

/** A package version row from the project packages API. */
export interface GitLabPackage {
    id: number;
    name: string;
    version: string;
    packageType: string;
    status: string;
}

/** A file belonging to a package version. */
export interface GitLabPackageFile {
    id: number;
    fileName: string;
    size?: number;
    sha256?: string;
}

export interface ClientOptions {
    /** Override `globalThis.fetch` (used by tests). */
    fetch?: typeof fetch;
    /** Maximum 429 retries (default 3). */
    maxRetries?: number;
    /** Cap on `Retry-After` seconds we'll honour (default 60). */
    maxRetryAfterSeconds?: number;
    /**
     * Global ceiling on concurrent in-flight requests. A function so the
     * ceiling can track the setting without reconstructing the client.
     * Defaults to 8.
     */
    maxConcurrent?: () => number;
}

export class GitLabClient {
    private readonly _projectCache = new Map<string, { id: number; path: string }>();
    private readonly _fetch: typeof fetch;
    private readonly _maxRetries: number;
    private readonly _maxRetryAfter: number;
    private readonly _maxConcurrent: () => number;
    /** One shared ceiling across ALL requests this client issues. */
    private readonly _sem: Semaphore;

    constructor(
        private readonly auth: AuthProvider,
        opts: ClientOptions = {},
    ) {
        this._fetch         = opts.fetch ?? globalThis.fetch.bind(globalThis);
        this._maxRetries    = opts.maxRetries ?? 3;
        this._maxRetryAfter = opts.maxRetryAfterSeconds ?? 60;
        this._maxConcurrent = opts.maxConcurrent ?? (() => 8);
        this._sem           = new Semaphore(this._maxConcurrent());
    }

    // ── Health / token check ─────────────────────────────────────────────────

    /** Resolves with the authenticated user's username, or rejects on bad PAT. */
    async validateToken(signal?: AbortSignal): Promise<{ username: string }> {
        return this._get<{ username: string }>('/user', signal);
    }

    // ── Pipelines & jobs (read) ──────────────────────────────────────────────

    async listPipelines(
        projectRef: string | number,
        params: ListPipelinesParams = {},
        signal?: AbortSignal,
    ): Promise<Pipeline[]> {
        const project = encodeURIComponent(String(projectRef));
        const qs = new URLSearchParams();
        qs.set('per_page', String(params.perPage ?? 20));
        if (params.page)         { qs.set('page',          String(params.page)); }
        if (params.ref)          { qs.set('ref',           params.ref); }
        if (params.status)       { qs.set('status',        params.status); }
        if (params.username)     { qs.set('username',      params.username); }
        if (params.updatedAfter) { qs.set('updated_after', params.updatedAfter); }
        qs.set('order_by', 'updated_at');
        qs.set('sort', 'desc');

        const raw  = await this._get<PipelineRaw[]>(
            `/projects/${project}/pipelines?${qs.toString()}`, signal,
        );
        const meta = await this._getProjectMeta(projectRef, signal);
        return raw.map(p => normalizePipeline(p, meta.id, meta.path));
    }

    async listJobs(
        projectRef: string | number,
        pipelineId: number,
        signal?: AbortSignal,
    ): Promise<Job[]> {
        const project = encodeURIComponent(String(projectRef));
        const basePath = `/projects/${project}/pipelines/${pipelineId}/jobs`;
        const qs = 'per_page=100&include_retried=false'
            + '&scope[]=created&scope[]=pending&scope[]=running'
            + '&scope[]=failed&scope[]=success&scope[]=canceled'
            + '&scope[]=skipped&scope[]=manual&scope[]=waiting_for_resource';

        const all: JobRaw[] = [];
        let page = 1;
         
        while (true) {
            const url = this._url(`${basePath}?${qs}&page=${page}`);
            const res = await this._fetchRaw(url, { headers: await this._headers(), signal });
            if (!res.ok) { throw await this._toError(url, res); }
            const batch = await res.json() as JobRaw[];
            all.push(...batch);
            const nextPage = res.headers.get('x-next-page');
            if (!nextPage || batch.length === 0) { break; }
            page = Number(nextPage);
        }

        const meta = await this._getProjectMeta(projectRef, signal);
        return all.map(j => normalizeJob(j, meta.id, meta.path, pipelineId));
    }

    /** Fetch bridge (trigger / downstream) jobs for a pipeline. */
    async listBridges(
        projectRef: string | number,
        pipelineId: number,
        signal?: AbortSignal,
    ): Promise<Job[]> {
        const project = encodeURIComponent(String(projectRef));
        const basePath = `/projects/${project}/pipelines/${pipelineId}/bridges`;

        const all: BridgeRaw[] = [];
        let page = 1;
         
        while (true) {
            const url = this._url(`${basePath}?per_page=100&page=${page}`);
            const res = await this._fetchRaw(url, { headers: await this._headers(), signal });
            if (res.status === 404) { break; }  // bridges endpoint may not exist on older GitLab
            if (!res.ok) { throw await this._toError(url, res); }
            const batch = await res.json() as BridgeRaw[];
            all.push(...batch);
            const nextPage = res.headers.get('x-next-page');
            if (!nextPage || batch.length === 0) { break; }
            page = Number(nextPage);
        }

        const meta = await this._getProjectMeta(projectRef, signal);
        return all.map(b => normalizeBridge(b, meta.id, meta.path, pipelineId));
    }

    // ── Pipeline / job actions (write) ───────────────────────────────────────

    /**
     * Trigger a new pipeline on `ref`, optionally passing CI/CD variables and
     * `spec:inputs` values (GitLab 17.7+; older servers ignore unknown keys
     * is NOT guaranteed, so `inputs` is only sent when non-empty).
     */
    async createPipeline(
        projectRef: string | number,
        ref: string,
        variables: ReadonlyArray<PipelineVariable> = [],
        inputs: Record<string, string | number | boolean> = {},
        signal?: AbortSignal,
    ): Promise<Pipeline> {
        const project = encodeURIComponent(String(projectRef));
        const body: Record<string, unknown> = { ref };
        if (variables.length > 0) {
            body.variables = variables.map(v => ({
                key: v.key,
                value: v.value,
                variable_type: v.variableType ?? 'env_var',
            }));
        }
        if (Object.keys(inputs).length > 0) {
            body.inputs = inputs;
        }
        const raw = await this._post<PipelineRaw>(`/projects/${project}/pipeline`, body, signal);
        const meta = await this._getProjectMeta(projectRef, signal);
        return normalizePipeline(raw, meta.id, meta.path);
    }

    async retryPipeline(
        projectRef: string | number,
        pipelineId: number,
        signal?: AbortSignal,
    ): Promise<void> {
        const project = encodeURIComponent(String(projectRef));
        await this._post(`/projects/${project}/pipelines/${pipelineId}/retry`, {}, signal);
    }

    async cancelPipeline(
        projectRef: string | number,
        pipelineId: number,
        signal?: AbortSignal,
    ): Promise<void> {
        const project = encodeURIComponent(String(projectRef));
        await this._post(`/projects/${project}/pipelines/${pipelineId}/cancel`, {}, signal);
    }

    async retryJob(
        projectRef: string | number,
        jobId: number,
        signal?: AbortSignal,
    ): Promise<void> {
        const project = encodeURIComponent(String(projectRef));
        await this._post(`/projects/${project}/jobs/${jobId}/retry`, {}, signal);
    }

    async cancelJob(
        projectRef: string | number,
        jobId: number,
        signal?: AbortSignal,
    ): Promise<void> {
        const project = encodeURIComponent(String(projectRef));
        await this._post(`/projects/${project}/jobs/${jobId}/cancel`, {}, signal);
    }

    /** Run a manual job, optionally with job-level variables. */
    async playJob(
        projectRef: string | number,
        jobId: number,
        variables: ReadonlyArray<PipelineVariable> = [],
        signal?: AbortSignal,
    ): Promise<void> {
        const project = encodeURIComponent(String(projectRef));
        const body: Record<string, unknown> = {};
        if (variables.length > 0) {
            body.job_variables_attributes = variables.map(v => ({
                key: v.key,
                value: v.value,
            }));
        }
        await this._post(`/projects/${project}/jobs/${jobId}/play`, body, signal);
    }

    // ── Pickers ──────────────────────────────────────────────────────────────

    /** List branches of a project (optionally filtered), default branch first. */
    async listBranches(
        projectRef: string | number,
        search?: string,
        signal?: AbortSignal,
    ): Promise<BranchHit[]> {
        const project = encodeURIComponent(String(projectRef));
        const qs = new URLSearchParams({ per_page: '50' });
        if (search) { qs.set('search', search); }
        const raw = await this._get<Array<{ name: string; default?: boolean }>>(
            `/projects/${project}/repository/branches?${qs.toString()}`, signal,
        );
        return raw
            .map(b => ({ name: b.name, default: Boolean(b.default) }))
            .sort((a, b) => Number(b.default) - Number(a.default));
    }

    /** Search projects the user is a member of (for the scope editor). */
    async searchProjects(query: string, signal?: AbortSignal): Promise<ProjectHit[]> {
        const qs = new URLSearchParams({
            search: query,
            membership: 'true',
            simple: 'true',
            order_by: 'last_activity_at',
            per_page: '30',
        });
        const raw = await this._get<Array<{
            id: number; path_with_namespace: string; description?: string;
        }>>(`/projects?${qs.toString()}`, signal);
        return raw.map(p => ({
            id: p.id,
            pathWithNamespace: p.path_with_namespace,
            description: p.description ?? undefined,
        }));
    }

    // ── Groups (Registry folders + Pipe group expansion) ─────────────────────

    /** Search groups the user can see (for the scope editor's group picker). */
    async searchGroups(query: string, signal?: AbortSignal): Promise<GroupHit[]> {
        const qs = new URLSearchParams({ search: query, per_page: '30' });
        const raw = await this._get<Array<{ id: number; full_path: string; name: string }>>(
            `/groups?${qs.toString()}`, signal,
        );
        return raw.map(g => ({ id: g.id, fullPath: g.full_path, name: g.name }));
    }

    /** Immediate subgroups of a group (lazy Registry folder browsing). */
    async listSubgroups(groupRef: string | number, signal?: AbortSignal): Promise<GroupHit[]> {
        const rows = await this._getAllPages<{ id: number; full_path: string; name: string }>(
            `/groups/${this._enc(groupRef)}/subgroups`,
            { per_page: '100', all_available: 'false' }, signal,
        );
        return rows.map(g => ({ id: g.id, fullPath: g.full_path, name: g.name }));
    }

    /**
     * Projects under a group. `includeSubgroups` = true does the whole subtree
     * in one paginated sweep (Pipe expansion); false lists only the group's
     * direct projects (lazy Registry folder browsing). Shared projects excluded.
     */
    async listGroupProjects(
        groupRef: string | number,
        includeSubgroups: boolean,
        signal?: AbortSignal,
    ): Promise<ProjectNode[]> {
        const rows = await this._getAllPages<{ id: number; path_with_namespace: string; name: string }>(
            `/groups/${this._enc(groupRef)}/projects`,
            {
                per_page: '100',
                include_subgroups: String(includeSubgroups),
                with_shared: 'false',
                archived: 'false',
            }, signal,
        );
        return rows.map(p => ({ id: p.id, pathWithNamespace: p.path_with_namespace, name: p.name }));
    }

    // ── Package registry ─────────────────────────────────────────────────────

    /** Ready package versions of a project (half-uploaded/errored ones dropped). */
    async listProjectPackages(
        projectRef: string | number,
        signal?: AbortSignal,
    ): Promise<GitLabPackage[]> {
        const rows = await this._getAllPages<{
            id: number; name: string; version: string; package_type: string; status?: string;
        }>(
            `/projects/${this._enc(projectRef)}/packages`,
            { per_page: '100', order_by: 'created_at', sort: 'desc' },
            signal, [403, 404],   // registry disabled on a project → treat as empty
        );
        return rows
            .filter(p => (p.status ?? 'default') === 'default')
            .map(p => ({
                id: p.id, name: p.name, version: p.version,
                packageType: p.package_type, status: p.status ?? 'default',
            }));
    }

    /** Files of a package version, deduped by file name (keep the newest row). */
    async listPackageFiles(
        projectRef: string | number,
        packageId: number,
        signal?: AbortSignal,
    ): Promise<GitLabPackageFile[]> {
        const rows = await this._getAllPages<{
            id: number; file_name: string; size?: number; file_sha256?: string;
        }>(
            `/projects/${this._enc(projectRef)}/packages/${packageId}/package_files`,
            { per_page: '100' }, signal, [403, 404],
        );
        const byName = new Map<string, GitLabPackageFile>();
        for (const r of rows) {
            byName.set(r.file_name, {
                id: r.id, fileName: r.file_name, size: r.size, sha256: r.file_sha256,
            });
        }
        return [...byName.values()];
    }

    /** Download URL for a file in a GENERIC package (the only type v1 downloads). */
    genericPackageFileUrl(
        projectRef: string | number,
        packageName: string,
        version: string,
        fileName: string,
    ): string {
        return this._url(
            `/projects/${this._enc(projectRef)}/packages/generic/`
            + `${this._enc(packageName)}/${this._enc(version)}/${this._enc(fileName)}`,
        );
    }

    /**
     * Fetch a package file as a binary response, streamable to disk.
     *
     * GitLab redirects package downloads to object storage (pre-signed URL).
     * `fetch` would forward our `PRIVATE-TOKEN` across that origin (a token
     * leak, and some backends reject the extra header), so we follow redirects
     * MANUALLY and drop the token on the redirected hop.
     */
    async fetchPackageFile(url: string, signal?: AbortSignal): Promise<Response> {
        const token = await this.auth.getToken();
        const firstHeaders: Record<string, string> = { 'Accept': '*/*' };
        if (token) { firstHeaders['PRIVATE-TOKEN'] = token; }

        let res = await this._sem.run(() =>
            this._fetch(url, { headers: firstHeaders, redirect: 'manual', signal }));

        let hops = 0;
        while (REDIRECT_STATUS.has(res.status) && hops < 5) {
            const loc = res.headers.get('location');
            if (!loc) { break; }
            // Redirected hop: NO PRIVATE-TOKEN (pre-signed URL carries its own auth).
            res = await this._sem.run(() =>
                this._fetch(loc, { headers: { 'Accept': '*/*' }, redirect: 'manual', signal }));
            hops++;
        }
        if (!res.ok) { throw await this._toError(url, res); }
        return res;
    }

    // ── Job trace (live log) ─────────────────────────────────────────────────

    async getJobTrace(
        projectRef: string | number,
        jobId: number,
        offset = 0,
        signal?: AbortSignal,
    ): Promise<JobTraceChunk> {
        const project = encodeURIComponent(String(projectRef));
        const url = this._url(`/projects/${project}/jobs/${jobId}/trace`);
        const headers = await this._headers();
        if (offset > 0) { headers['Range'] = `bytes=${offset}-`; }

        const res = await this._fetchRaw(url, { headers, signal });

        if (res.status === 416) { return { text: '', nextOffset: offset, complete: false }; }
        if (res.status === 404) { return { text: '', nextOffset: offset, complete: false }; }
        if (res.status !== 200 && res.status !== 206) {
            throw await this._toError(url, res);
        }

        const text = await res.text();
        const cr   = res.headers.get('content-range');
        let nextOffset = offset;
        let replace = false;

        if (res.status === 206 && cr) {
            const m = /bytes\s+\d+-\d+\/(\d+)/.exec(cr);
            nextOffset = m ? Number(m[1]) : offset + Buffer.byteLength(text, 'utf-8');
        } else if (res.status === 200 && offset > 0) {
            // Server ignored Range — caller must replace.
            replace = true;
            nextOffset = Buffer.byteLength(text, 'utf-8');
        } else {
            nextOffset = offset + Buffer.byteLength(text, 'utf-8');
        }

        return { text, nextOffset, complete: false, replace };
    }

    // ── Artifacts ────────────────────────────────────────────────────────────

    async downloadArtifacts(
        projectRef: string | number,
        jobId: number,
        signal?: AbortSignal,
    ): Promise<ArrayBuffer> {
        const project = encodeURIComponent(String(projectRef));
        const url = this._url(`/projects/${project}/jobs/${jobId}/artifacts`);
        const res = await this._fetchRaw(url, { headers: await this._headers(), signal });
        if (!res.ok) { throw await this._toError(url, res); }
        return res.arrayBuffer();
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private async _getProjectMeta(
        ref: string | number,
        signal?: AbortSignal,
    ): Promise<{ id: number; path: string }> {
        const key = String(ref);
        const cached = this._projectCache.get(key);
        if (cached) { return cached; }
        const raw = await this._get<{ id: number; path_with_namespace: string }>(
            `/projects/${encodeURIComponent(key)}`, signal,
        );
        const meta = { id: raw.id, path: raw.path_with_namespace };
        this._projectCache.set(key, meta);
        this._projectCache.set(String(raw.id), meta);
        return meta;
    }

    private _enc(ref: string | number): string {
        return encodeURIComponent(String(ref));
    }

    /**
     * GET every page of a list endpoint, following `x-next-page`.
     * Statuses in `tolerate` (e.g. 403/404 for a disabled registry) resolve to
     * an empty result instead of throwing, so one bad project/group doesn't
     * fail the whole browse.
     */
    private async _getAllPages<T>(
        basePath: string,
        params: Record<string, string>,
        signal?: AbortSignal,
        tolerate: number[] = [],
    ): Promise<T[]> {
        const all: T[] = [];
        let page = 1;
        while (true) {
            const qs = new URLSearchParams({ ...params, page: String(page) });
            const url = this._url(`${basePath}?${qs.toString()}`);
            const res = await this._fetchRaw(url, { headers: await this._headers(), signal });
            if (tolerate.includes(res.status)) { break; }
            if (!res.ok) { throw await this._toError(url, res); }
            const batch = await res.json() as T[];
            all.push(...batch);
            const next = res.headers.get('x-next-page');
            const nextPage = Number(next);
            if (!next || batch.length === 0 || !Number.isFinite(nextPage) || nextPage <= page) {
                break;
            }
            page = nextPage;
        }
        return all;
    }

    private _url(pathStr: string): string {
        const base = this.auth.baseUrl().replace(/\/+$/, '').replace(/\/api\/v4$/, '');
        const tail = pathStr.startsWith('/') ? pathStr : `/${pathStr}`;
        return `${base}/api/v4${tail}`;
    }

    private async _headers(json = false): Promise<Record<string, string>> {
        const token = await this.auth.getToken();
        const h: Record<string, string> = { 'Accept': 'application/json' };
        if (json)  { h['Content-Type'] = 'application/json'; }
        if (token) { h['PRIVATE-TOKEN'] = token; }
        return h;
    }

    private async _get<T>(pathStr: string, signal?: AbortSignal): Promise<T> {
        const url = this._url(pathStr);
        const res = await this._fetchRaw(url, { headers: await this._headers(), signal });
        if (!res.ok) { throw await this._toError(url, res); }
        return res.json() as Promise<T>;
    }

    private async _post<T = unknown>(
        pathStr: string,
        body: Record<string, unknown>,
        signal?: AbortSignal,
    ): Promise<T> {
        const url = this._url(pathStr);
        const res = await this._fetchRaw(url, {
            method: 'POST',
            headers: await this._headers(true),
            body: JSON.stringify(body),
            signal,
        });
        if (!res.ok) { throw await this._toError(url, res); }
        return res.json().catch(() => undefined) as Promise<T>;
    }

    /** `fetch` wrapper with 429-retry honoring `Retry-After`. */
    private async _fetchRaw(
        url: string,
        init: {
            method?: string;
            headers: Record<string, string>;
            body?: string;
            signal?: AbortSignal;
        },
    ): Promise<Response> {
        let attempt = 0;
        // Keep the shared ceiling in step with the current setting, then run
        // each fetch attempt through it (the retry sleep releases the permit,
        // so a backing-off request never occupies a slot).
        this._sem.setLimit(this._maxConcurrent());

        while (true) {
            const res = await this._sem.run(() => this._fetch(url, init));
            if (res.status !== 429 || attempt >= this._maxRetries) { return res; }
            const retryAfter = parseRetryAfter(res.headers.get('retry-after')) ?? (1 + attempt);
            const delaySec = Math.min(this._maxRetryAfter, Math.max(1, retryAfter));
            await sleep(delaySec * 1000, init.signal);
            attempt++;
        }
    }

    private async _toError(url: string, res: Response): Promise<GitLabApiError> {
        let body: string | undefined;
        try { body = await res.text(); } catch { /* ignore */ }
        return new GitLabApiError(
            `GitLab ${res.status} ${res.statusText} for ${url}`,
            res.status, url, body,
        );
    }
}

/** Extract a human-readable message from a GitLab error response body. */
export function describeApiError(err: unknown): string {
    if (err instanceof GitLabApiError) {
        if (err.body) {
            try {
                const parsed = JSON.parse(err.body) as { message?: unknown; error?: unknown };
                const msg = parsed.message ?? parsed.error;
                if (typeof msg === 'string') { return `${err.status}: ${msg}`; }
                if (msg && typeof msg === 'object') { return `${err.status}: ${JSON.stringify(msg)}`; }
            } catch { /* not JSON */ }
        }
        return err.message;
    }
    return err instanceof Error ? err.message : String(err);
}

// ── Free helpers ────────────────────────────────────────────────────────────

/** HTTP statuses we follow manually when downloading package files. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

function parseRetryAfter(value: string | null): number | undefined {
    if (!value) { return undefined; }
    const n = Number(value);
    if (Number.isFinite(n)) { return n; }
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) {
        return Math.max(0, Math.round((ts - Date.now()) / 1000));
    }
    return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
        const t = setTimeout(() => resolve(), ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
    });
}

// ── Raw API shapes (only what we read) ──────────────────────────────────────

interface PipelineRaw {
    id: number;
    iid?: number;
    project_id?: number;
    ref: string;
    sha: string;
    status: GitLabStatus;
    source?: string;
    web_url: string;
    created_at: string;
    updated_at: string;
    user?: { username: string; name?: string };
}

interface JobRaw {
    id: number;
    name: string;
    stage: string;
    status: GitLabStatus;
    ref: string;
    web_url: string;
    started_at?: string;
    finished_at?: string;
    duration?: number;
    artifacts_file?: { filename: string };
    artifacts?: unknown[];
    allow_failure?: boolean;
    pipeline?: { id: number };
}

interface BridgeRaw {
    id: number;
    name: string;
    stage: string;
    status: GitLabStatus;
    ref: string;
    web_url: string;
    created_at?: string;
    started_at?: string;
    finished_at?: string;
    duration?: number;
    allow_failure?: boolean;
    downstream_pipeline?: {
        id: number;
        project_id?: number;
        web_url: string;
        status: GitLabStatus;
    };
}

function normalizePipeline(p: PipelineRaw, projectId: number, projectPath: string): Pipeline {
    return {
        id: p.id,
        iid: p.iid,
        projectId,
        projectPath,
        ref: p.ref,
        sha: p.sha,
        status: p.status,
        source: p.source,
        webUrl: p.web_url,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        user: p.user,
        jobs: [],
    };
}

function normalizeJob(j: JobRaw, projectId: number, projectPath: string, pipelineId: number): Job {
    const hasArtifacts =
        Boolean(j.artifacts_file) ||
        (Array.isArray(j.artifacts) && j.artifacts.length > 0);
    return {
        id: j.id,
        name: j.name,
        stage: j.stage,
        status: j.status,
        ref: j.ref,
        webUrl: j.web_url,
        startedAt: j.started_at,
        finishedAt: j.finished_at,
        duration: j.duration,
        pipelineId,
        projectId,
        projectPath,
        hasArtifacts,
        allowFailure: j.allow_failure,
        manualPlayable: j.status === 'manual',
    };
}

function normalizeBridge(b: BridgeRaw, projectId: number, projectPath: string, pipelineId: number): Job {
    return {
        id: b.id,
        name: b.name,
        stage: b.stage,
        status: b.status,
        ref: b.ref,
        webUrl: b.web_url,
        startedAt: b.started_at,
        finishedAt: b.finished_at,
        duration: b.duration,
        pipelineId,
        projectId,
        projectPath,
        hasArtifacts: false,
        allowFailure: b.allow_failure,
        manualPlayable: b.status === 'manual',
        isBridge: true,
        downstreamUrl: b.downstream_pipeline?.web_url,
        downstreamPipelineId: b.downstream_pipeline?.id,
        downstreamProjectId: b.downstream_pipeline?.project_id ?? projectId,
    };
}

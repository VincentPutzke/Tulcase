/**
 * In-memory state container for pipelines + jobs, keyed by stable scope id.
 *
 * Emits granular transition events used by the notifier:
 *   - `onJobStatusChange`      — a job's status changed (gates "opened log" toasts),
 *   - `onPipelineStatusChange` — a pipeline's status changed (gates "Follow" toasts).
 *
 * Status maps are pruned whenever entries disappear from every scope so a
 * long-running session doesn't accumulate stale keys.
 */

import { Emitter } from './events';
import type { Pipeline, Job, GitLabStatus } from './models';

export interface JobStatusTransition {
    job: Job;
    oldStatus: GitLabStatus | undefined;
    newStatus: GitLabStatus;
}

export interface PipelineStatusTransition {
    pipeline: Pipeline;
    oldStatus: GitLabStatus | undefined;
    newStatus: GitLabStatus;
}

export interface ScopeSnapshot {
    scopeId: string;
    pipelines: Pipeline[];
}

export class PipelineStore {
    /** scopeId → pipelineId → pipeline. */
    private readonly _byScope = new Map<string, Map<number, Pipeline>>();

    /** `${pipelineId}:${jobId}` → last known status (transition tracking). */
    private readonly _lastJobStatus = new Map<string, GitLabStatus>();

    /** pipelineId → last known status (transition tracking). */
    private readonly _lastPipelineStatus = new Map<number, GitLabStatus>();

    private readonly _onDidChange            = new Emitter<void>();
    private readonly _onJobStatusChange      = new Emitter<JobStatusTransition>();
    private readonly _onPipelineStatusChange = new Emitter<PipelineStatusTransition>();

    readonly onDidChange            = this._onDidChange.event;
    readonly onJobStatusChange      = this._onJobStatusChange.event;
    readonly onPipelineStatusChange = this._onPipelineStatusChange.event;

    /** Replace the pipelines for a given scope (idempotent). */
    setScopePipelines(scopeId: string, pipelines: ReadonlyArray<Pipeline>): void {
        const map = new Map<number, Pipeline>();
        for (const p of pipelines) {
            map.set(p.id, p);
            this._firePipelineIfChanged(p);
            this._walkJobs(p.jobs);
        }
        const previous = this._byScope.get(scopeId);
        this._byScope.set(scopeId, map);
        // Status-map pruning walks the whole store — only needed when this
        // update actually evicted pipelines from the scope.
        if (previous && !isSubset(previous, map)) {
            this._pruneStatusMaps();
        }
        this._onDidChange.fire();
    }

    clearScope(scopeId: string): void {
        if (this._byScope.delete(scopeId)) {
            this._pruneStatusMaps();
            this._onDidChange.fire();
        }
    }

    /** Drop any scope whose id is not in `keepIds`. */
    pruneScopeIds(keepIds: ReadonlyArray<string>): void {
        const keep = new Set(keepIds);
        let changed = false;
        for (const id of Array.from(this._byScope.keys())) {
            if (!keep.has(id)) {
                this._byScope.delete(id);
                changed = true;
            }
        }
        if (changed) {
            this._pruneStatusMaps();
            this._onDidChange.fire();
        }
    }

    clearAll(): void {
        if (this._byScope.size === 0 && this._lastJobStatus.size === 0) { return; }
        this._byScope.clear();
        this._lastJobStatus.clear();
        this._lastPipelineStatus.clear();
        this._onDidChange.fire();
    }

    /** Snapshot of all scopes, sorted by id for deterministic iteration. */
    snapshot(): ScopeSnapshot[] {
        const out: ScopeSnapshot[] = [];
        for (const [scopeId, map] of this._byScope.entries()) {
            out.push({ scopeId, pipelines: Array.from(map.values()) });
        }
        out.sort((a, b) => a.scopeId.localeCompare(b.scopeId));
        return out;
    }

    scopeSnapshot(scopeId: string): Pipeline[] {
        const map = this._byScope.get(scopeId);
        return map ? Array.from(map.values()) : [];
    }

    /** Whether a pipeline currently appears in the given scope. */
    scopeHasPipeline(scopeId: string, pipelineId: number): boolean {
        return this._byScope.get(scopeId)?.has(pipelineId) ?? false;
    }

    findPipeline(pipelineId: number): Pipeline | undefined {
        for (const map of this._byScope.values()) {
            const p = map.get(pipelineId);
            if (p) { return p; }
        }
        return undefined;
    }

    findJob(jobId: number): Job | undefined {
        for (const map of this._byScope.values()) {
            for (const p of map.values()) {
                const found = this._findInJobs(p.jobs, jobId);
                if (found) { return found; }
            }
        }
        return undefined;
    }

    private _findInJobs(jobs: ReadonlyArray<Job>, jobId: number): Job | undefined {
        for (const j of jobs) {
            if (j.id === jobId) { return j; }
            if (j.children) {
                const found = this._findInJobs(j.children, jobId);
                if (found) { return found; }
            }
        }
        return undefined;
    }

    private _walkJobs(jobs: ReadonlyArray<Job>): void {
        for (const job of jobs) {
            this._fireJobIfChanged(job);
            if (job.children) { this._walkJobs(job.children); }
        }
    }

    private _fireJobIfChanged(job: Job): void {
        const key = `${job.pipelineId}:${job.id}`;
        const prev = this._lastJobStatus.get(key);
        if (prev !== job.status) {
            this._lastJobStatus.set(key, job.status);
            this._onJobStatusChange.fire({ job, oldStatus: prev, newStatus: job.status });
        }
    }

    private _firePipelineIfChanged(pipeline: Pipeline): void {
        const prev = this._lastPipelineStatus.get(pipeline.id);
        if (prev !== pipeline.status) {
            this._lastPipelineStatus.set(pipeline.id, pipeline.status);
            this._onPipelineStatusChange.fire({
                pipeline, oldStatus: prev, newStatus: pipeline.status,
            });
        }
    }

    /** Drop transition-tracking keys for entries no longer present anywhere. */
    private _pruneStatusMaps(): void {
        const livePipelines = new Set<number>();
        const liveJobKeys = new Set<string>();
        const collect = (jobs: ReadonlyArray<Job>): void => {
            for (const j of jobs) {
                liveJobKeys.add(`${j.pipelineId}:${j.id}`);
                if (j.children) { collect(j.children); }
            }
        };
        for (const map of this._byScope.values()) {
            for (const p of map.values()) {
                livePipelines.add(p.id);
                collect(p.jobs);
            }
        }
        for (const id of Array.from(this._lastPipelineStatus.keys())) {
            if (!livePipelines.has(id)) { this._lastPipelineStatus.delete(id); }
        }
        for (const key of Array.from(this._lastJobStatus.keys())) {
            if (!liveJobKeys.has(key)) { this._lastJobStatus.delete(key); }
        }
    }

    dispose(): void {
        this._onDidChange.dispose();
        this._onJobStatusChange.dispose();
        this._onPipelineStatusChange.dispose();
    }
}

/** True when every key of `prev` still exists in `next`. */
function isSubset(prev: Map<number, unknown>, next: Map<number, unknown>): boolean {
    for (const id of prev.keys()) {
        if (!next.has(id)) { return false; }
    }
    return true;
}

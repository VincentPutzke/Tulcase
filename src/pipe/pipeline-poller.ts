/**
 * Periodic pipeline + job fetcher.
 *
 * Polls in one of three modes so "Follow" notifications keep working while
 * the Pipelines view is hidden, without hammering the API for scopes nobody
 * is watching:
 *
 *   - `'all'`      — view is visible: poll every enabled scope.
 *   - `'followed'` — view hidden but followed scopes exist: poll only those.
 *   - `'off'`      — nothing to do.
 *
 * Per-project requests fan out with bounded concurrency; removed or disabled
 * scopes are pruned from the store so stale data disappears immediately.
 */

import { PollerBase } from './poller-base';
import type { GitLabClient } from './gitlab-client';
import type { PipelineStore } from './pipeline-store';
import type { PipeScopeStore } from './scope-store';
import { applyScopeFilters, scopeToServerParams } from './scope-filters';
import { pAllSettledLimit } from './concurrency';
import { TERMINAL_STATUSES, type Job, type Pipeline, type PipeScope } from './models';

export type PollMode = 'all' | 'followed' | 'off';

/** The slice of pipe config the poller needs (injected for testability). */
export interface PipelinePollerConfig {
    pollIntervalSeconds: number;
    maxConcurrentRequests: number;
}

export class PipelinePoller extends PollerBase {
    private _mode: PollMode = 'off';

    constructor(
        private readonly getConfig: () => PipelinePollerConfig,
        private readonly client:    GitLabClient,
        private readonly store:     PipelineStore,
        private readonly scopes:    PipeScopeStore,
    ) {
        super();
    }

    get mode(): PollMode {
        return this._mode;
    }

    /** Switch polling mode; an upgrade while active triggers an instant tick. */
    setMode(mode: PollMode): void {
        if (this._mode === mode) { return; }
        const wasActive = this.isActive;
        this._mode = mode;
        if (mode === 'off') {
            this.setActive(false);
            return;
        }
        this.setActive(true);
        if (wasActive) {
            // Already running (e.g. followed → all): refresh with the new set now.
            void this.tickNow();
        }
    }

    protected intervalMs(): number {
        return this.getConfig().pollIntervalSeconds * 1000;
    }

    protected async tick(signal: AbortSignal): Promise<void> {
        const all = await this.scopes.listScopes();
        const enabled = all.filter(s => s.enabled);

        // Keep data for every enabled scope (even in followed-only mode the
        // hidden view should show recent data when re-opened), but only fetch
        // the mode's subset.  Mode 'off' still serves explicit `tickNow()`
        // calls (refresh command, post-action re-polls) with a full fetch —
        // scheduled polling simply never runs in that mode.
        this.store.pruneScopeIds(enabled.map(s => s.id));

        const toFetch = this._mode === 'followed'
            ? enabled.filter(s => s.follow)
            : enabled;
        if (toFetch.length === 0) { return; }

        const concurrency = this.getConfig().maxConcurrentRequests;
        await pAllSettledLimit(toFetch, concurrency, async (scope) => {
            await this._fetchScope(scope, signal, concurrency);
        });
    }

    private async _fetchScope(
        scope: PipeScope,
        signal: AbortSignal,
        concurrency: number,
    ): Promise<void> {
        // Fetch project pipelines in parallel (bounded).
        const params = scopeToServerParams(scope);
        const fetched = await pAllSettledLimit(
            scope.projects, concurrency,
            async (project) => this.client.listPipelines(project, params, signal),
        );

        const aggregated: Pipeline[] = [];
        for (const r of fetched) {
            if (r.status === 'fulfilled') {
                aggregated.push(...r.value);
            } else {
                this.raiseError(r.reason);
            }
        }

        aggregated.sort((a, b) =>
            Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        );
        const filtered = applyScopeFilters(aggregated, scope);

        // Reuse jobs from the previous snapshot for terminal/unchanged pipelines.
        const previous = new Map(this.store.scopeSnapshot(scope.id).map(p => [p.id, p] as const));

        const jobResults = await pAllSettledLimit(filtered, concurrency, async (p) => {
            const prev = previous.get(p.id);
            const isTerminal = (TERMINAL_STATUSES as readonly string[]).includes(p.status);
            if (prev && isTerminal && prev.jobs.length > 0 && prev.status === p.status) {
                p.jobs = prev.jobs;
                return p;
            }
            try {
                p.jobs = await this._fetchAllJobs(
                    p.projectId, p.id, signal, concurrency,
                );
            } catch (err) {
                this.raiseError(err);
                p.jobs = prev?.jobs ?? [];
            }
            return p;
        });

        // Materialise in-order results (pAllSettledLimit preserves order).
        const out = jobResults
            .map(r => (r.status === 'fulfilled' ? r.value : undefined))
            .filter((p): p is Pipeline => Boolean(p));

        this.store.setScopePipelines(scope.id, out);
    }

    /**
     * Fetch all jobs for a pipeline, including downstream (child) pipeline
     * jobs spawned by bridge/trigger jobs.  Downstream jobs are stored as
     * `children` on the bridge job so the tree view can nest them.
     *
     * Recurses up to `maxDepth` levels to handle nested child pipelines.
     */
    private async _fetchAllJobs(
        projectId: number | string,
        pipelineId: number,
        signal: AbortSignal,
        concurrency: number,
        depth = 0,
        maxDepth = 3,
    ): Promise<Job[]> {
        const [jobs, bridges] = await Promise.all([
            this.client.listJobs(projectId, pipelineId, signal),
            this.client.listBridges(projectId, pipelineId, signal),
        ]);

        // Recurse into downstream pipelines and attach as children.
        if (depth < maxDepth) {
            const bridgesWithDownstream = bridges.filter(
                b => b.isBridge && b.downstreamPipelineId,
            );
            const downstreamResults = await pAllSettledLimit(
                bridgesWithDownstream, concurrency,
                async (bridge) => {
                    bridge.children = await this._fetchAllJobs(
                        bridge.downstreamProjectId ?? projectId,
                        bridge.downstreamPipelineId!,
                        signal,
                        concurrency,
                        depth + 1,
                        maxDepth,
                    );
                },
            );
            for (const r of downstreamResults) {
                if (r.status === 'rejected') {
                    this.raiseError(r.reason);
                }
            }
        }

        return [...jobs, ...bridges];
    }
}

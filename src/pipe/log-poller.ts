/**
 * Per-job log streamer.  One `JobLogSession` per job the user opens.
 *
 *   - **Final flush**: after the job becomes terminal, exactly one more poll
 *     captures tail bytes the server is still flushing.
 *   - **In-flight guard**: prevents overlapping ticks when a poll takes
 *     longer than the configured interval.
 *   - **`Range` fallback**: if the server returned the full body in response
 *     to a `Range` request, the buffer is *replaced* instead of appended.
 *   - Scope log rules are resolved per job and applied per chunk.
 */

import { Emitter } from './events';
import type { GitLabClient } from './gitlab-client';
import type { PipelineStore } from './pipeline-store';
import type { PipeScopeStore } from './scope-store';
import { TERMINAL_STATUSES, type Job, type GitLabStatus } from './models';
import { isAbort } from './poller-base';
import { LogRuleEngine, mergeRuleDefinitions, type CompiledRule } from './log-rules';

export interface LogChunkEvent {
    jobId: number;
    text: string;
    /** When true, replaces the consumer's buffer instead of appending. */
    replace?: boolean;
    /** Marks the last event for this session. */
    isFinal?: boolean;
}

const ANSI_REGEX =
    /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
    return text.replace(ANSI_REGEX, '');
}

/** The slice of pipe config the log poller needs (injected for testability). */
export interface LogPollerConfig {
    logPollIntervalSeconds: number;
}

export class JobLogSession {
    private _offset = 0;
    private _timer: NodeJS.Timeout | undefined;
    private _abort: AbortController | undefined;
    private _disposed = false;
    private _inFlight = false;
    private _buffer = '';
    /** Held-back partial last line (rules are line-based; trace chunks split
     *  mid-line, so incomplete lines wait for their newline — or the final
     *  flush — before rules run). Only used when rules are active. */
    private _pendingTail = '';
    private _terminalSeen = false;
    private _finalFlushDone = false;
    private readonly _rules: CompiledRule[];

    private readonly _onLogChunk = new Emitter<LogChunkEvent>();
    readonly onLogChunk = this._onLogChunk.event;

    constructor(
        public readonly job: Job,
        private readonly client: GitLabClient,
        private readonly getConfig: () => LogPollerConfig,
        private readonly store:  PipelineStore,
        rules: CompiledRule[] = [],
    ) {
        this._rules = rules;
    }

    /** Start polling.  Resolves after the first tick. */
    async start(): Promise<void> {
        await this._tick();
        this._schedule();
    }

    snapshot(): string { return this._buffer; }

    /** True once the job finished and the final flush was emitted. */
    get isComplete(): boolean { return this._finalFlushDone; }

    private _schedule(): void {
        if (this._disposed) { return; }
        if (this._terminalSeen && this._finalFlushDone) { return; }
        const seconds = this.getConfig().logPollIntervalSeconds;
        this._timer = setTimeout(async () => {
            await this._tick();
            this._schedule();
        }, seconds * 1000);
    }

    private async _tick(): Promise<void> {
        if (this._disposed || this._inFlight) { return; }
        this._inFlight = true;
        this._abort?.abort();
        this._abort = new AbortController();
        try {
            const chunk = await this.client.getJobTrace(
                this.job.projectId, this.job.id, this._offset, this._abort.signal,
            );
            this._consume(chunk.text, Boolean(chunk.replace));
            this._offset = chunk.nextOffset;
        } catch (err) {
            if (!isAbort(err)) {
                const msg = `\n[Tulcase Pipe] Log fetch failed: ${
                    err instanceof Error ? err.message : String(err)
                }\n`;
                this._buffer += msg;
                this._onLogChunk.fire({ jobId: this.job.id, text: msg });
            }
        } finally {
            this._inFlight = false;
        }

        // Re-read job state from the store to detect terminal status.
        const fresh = this.store.findJob(this.job.id) ?? this.job;
        const isTerminal = (TERMINAL_STATUSES as ReadonlyArray<GitLabStatus>).includes(fresh.status);
        if (isTerminal) {
            if (!this._terminalSeen) {
                this._terminalSeen = true;
                // Schedule one final flush (next tick) before declaring done.
            } else if (!this._finalFlushDone) {
                this._finalFlushDone = true;
                this._flushTail();
                this._onLogChunk.fire({ jobId: this.job.id, text: '', isFinal: true });
            }
        }
    }

    /** Apply rules and append/replace, holding back the trailing partial line. */
    private _consume(text: string, replace: boolean): void {
        if (this._rules.length === 0) {
            // No transformation — no need to delay partial lines.
            if (replace) {
                this._buffer = text;
                this._onLogChunk.fire({ jobId: this.job.id, text, replace: true });
            } else if (text.length > 0) {
                this._buffer += text;
                this._onLogChunk.fire({ jobId: this.job.id, text });
            }
            return;
        }

        if (replace) { this._pendingTail = ''; }
        const combined = this._pendingTail + text;
        const cut = combined.lastIndexOf('\n');
        const complete = cut >= 0 ? combined.slice(0, cut + 1) : '';
        this._pendingTail = cut >= 0 ? combined.slice(cut + 1) : combined;

        const transformed = complete ? LogRuleEngine.apply(complete, this._rules) : '';
        if (replace) {
            this._buffer = transformed;
            this._onLogChunk.fire({ jobId: this.job.id, text: transformed, replace: true });
        } else if (transformed.length > 0) {
            this._buffer += transformed;
            this._onLogChunk.fire({ jobId: this.job.id, text: transformed });
        }
    }

    /** Run rules over a held-back final partial line (job finished without newline). */
    private _flushTail(): void {
        if (!this._pendingTail) { return; }
        const transformed = LogRuleEngine.apply(this._pendingTail, this._rules);
        this._pendingTail = '';
        if (transformed.length > 0) {
            this._buffer += transformed;
            this._onLogChunk.fire({ jobId: this.job.id, text: transformed });
        }
    }

    dispose(): void {
        this._disposed = true;
        if (this._timer) { clearTimeout(this._timer); this._timer = undefined; }
        this._abort?.abort();
        this._abort = undefined;
        this._onLogChunk.dispose();
    }
}

/** Coordinator: one session per `jobId`, reuses on re-open. */
export class LogPoller {
    private readonly _sessions = new Map<number, JobLogSession>();
    private readonly _engine = new LogRuleEngine();

    constructor(
        private readonly client: GitLabClient,
        private readonly getConfig: () => LogPollerConfig,
        private readonly store:  PipelineStore,
        private readonly scopes: PipeScopeStore,
    ) {}

    async open(job: Job): Promise<JobLogSession> {
        const existing = this._sessions.get(job.id);
        if (existing) { return existing; }

        const rules = await this._resolveRulesForJob(job);
        const session = new JobLogSession(job, this.client, this.getConfig, this.store, rules);
        this._sessions.set(job.id, session);
        await session.start();
        return session;
    }

    /**
     * Resolve the log rules for the first enabled scope containing the job's
     * project.  Built-in rules are always available; custom rules override
     * built-ins with the same name.
     */
    private async _resolveRulesForJob(job: Job): Promise<CompiledRule[]> {
        const data = await this.scopes.read();
        this._engine.setDefinitions(mergeRuleDefinitions(data.logRules));

        for (const scope of data.scopes) {
            if (!scope.enabled) { continue; }
            for (const proj of scope.projects) {
                if (String(proj) === String(job.projectId) ||
                    String(proj) === String(job.projectPath)) {
                    return scope.logRules && scope.logRules.length > 0
                        ? this._engine.resolve(scope.logRules)
                        : [];
                }
            }
        }
        return [];
    }

    getSession(jobId: number): JobLogSession | undefined {
        return this._sessions.get(jobId);
    }

    closeJob(jobId: number): void {
        const s = this._sessions.get(jobId);
        if (s) { s.dispose(); this._sessions.delete(jobId); }
    }

    dispose(): void {
        for (const s of this._sessions.values()) { s.dispose(); }
        this._sessions.clear();
    }
}

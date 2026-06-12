import { describe, it, expect, vi } from 'vitest';
import { JobLogSession, stripAnsi } from '../pipe/log-poller';
import { PipelineStore } from '../pipe/pipeline-store';
import type { GitLabClient } from '../pipe/gitlab-client';
import type { Job, Pipeline, GitLabStatus } from '../pipe/models';

describe('stripAnsi', () => {
    it('strips CSI sequences', () => {
        expect(stripAnsi('\x1b[31mhello\x1b[0m world')).toBe('hello world');
    });

    it('strips OSC sequences', () => {
        expect(stripAnsi('\x1b]0;title\x07 normal')).toBe(' normal');
    });

    it('leaves plain text alone', () => {
        expect(stripAnsi('plain text')).toBe('plain text');
    });
});

// ── Session lifecycle ────────────────────────────────────────────────────────

function makeJob(status: GitLabStatus): { job: Job; store: PipelineStore } {
    const job: Job = {
        id: 9, name: 'build', stage: 'build', status, ref: 'main',
        webUrl: '', pipelineId: 1, projectId: 1, projectPath: 'g/p',
    };
    const pipeline: Pipeline = {
        id: 1, projectId: 1, projectPath: 'g/p', ref: 'main', sha: 'a',
        status, webUrl: '', createdAt: '', updatedAt: '', jobs: [job],
    };
    const store = new PipelineStore();
    store.setScopePipelines('A', [pipeline]);
    return { job, store };
}

describe('JobLogSession', () => {
    it('streams chunks, then emits exactly one final flush after terminal', async () => {
        const { job, store } = makeJob('success');
        let calls = 0;
        const client = {
            getJobTrace: vi.fn(async (_p: unknown, _j: unknown, offset: number) => {
                calls++;
                return calls === 1
                    ? { text: 'hello ', nextOffset: 6, complete: false }
                    : { text: calls === 2 ? 'world' : '', nextOffset: offset + 5, complete: false };
            }),
        } as unknown as GitLabClient;

        const session = new JobLogSession(
            job, client, () => ({ logPollIntervalSeconds: 0.01 }), store,
        );
        const events: Array<{ text: string; isFinal?: boolean }> = [];
        session.onLogChunk(e => events.push({ text: e.text, isFinal: e.isFinal }));

        await session.start();
        await new Promise(r => setTimeout(r, 200));

        expect(session.snapshot()).toBe('hello world');
        const finals = events.filter(e => e.isFinal);
        expect(finals).toHaveLength(1);
        expect(session.isComplete).toBe(true);
        session.dispose();
    });

    it('replaces the buffer when the chunk says so', async () => {
        const { job, store } = makeJob('running');
        let calls = 0;
        const client = {
            getJobTrace: vi.fn(async () => {
                calls++;
                return calls === 1
                    ? { text: 'partial', nextOffset: 7, complete: false }
                    : { text: 'rewritten', nextOffset: 9, complete: false, replace: true };
            }),
        } as unknown as GitLabClient;

        const session = new JobLogSession(
            job, client, () => ({ logPollIntervalSeconds: 0.01 }), store,
        );
        await session.start();
        await new Promise(r => setTimeout(r, 60));
        session.dispose();

        expect(session.snapshot()).toBe('rewritten');
    });

    it('applies log rules to chunks', async () => {
        const { job, store } = makeJob('running');
        const client = {
            getJobTrace: vi.fn(async () => ({
                text: '2026-01-01T00:00:00Z npm ok', nextOffset: 1, complete: false,
            })),
        } as unknown as GitLabClient;

        const session = new JobLogSession(
            job, client, () => ({ logPollIntervalSeconds: 60 }), store,
            [{ regex: /\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/g, mode: 'remove', replacement: '' }],
        );
        await session.start();
        session.dispose();
        expect(session.snapshot()).toBe('npm ok');
    });
});

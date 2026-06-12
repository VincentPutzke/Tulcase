import { describe, it, expect } from 'vitest';
import { PipelineStore } from '../pipe/pipeline-store';
import type { Pipeline, GitLabStatus } from '../pipe/models';

const pipe = (
    id: number,
    jobs: Array<{ id: number; status: GitLabStatus }> = [],
    status: GitLabStatus = 'success',
): Pipeline => ({
    id, projectId: 1, projectPath: 'g/p', ref: 'main', sha: 'a', status,
    webUrl: '', createdAt: '', updatedAt: '',
    jobs: jobs.map(j => ({
        id: j.id, name: 'j', stage: 's', status: j.status, ref: 'main',
        webUrl: '', pipelineId: id, projectId: 1, projectPath: 'g/p',
    })),
});

describe('PipelineStore', () => {
    it('replaces pipelines per scope', () => {
        const s = new PipelineStore();
        s.setScopePipelines('A', [pipe(1)]);
        s.setScopePipelines('A', [pipe(2)]);
        expect(s.findPipeline(1)).toBeUndefined();
        expect(s.findPipeline(2)).toBeDefined();
    });

    it('prunes scopes not in keep list', () => {
        const s = new PipelineStore();
        s.setScopePipelines('A', [pipe(1)]);
        s.setScopePipelines('B', [pipe(2)]);
        s.pruneScopeIds(['A']);
        expect(s.findPipeline(1)).toBeDefined();
        expect(s.findPipeline(2)).toBeUndefined();
    });

    it('emits job status transitions only on change', () => {
        const s = new PipelineStore();
        const events: Array<[unknown, string]> = [];
        s.onJobStatusChange(t => events.push([t.oldStatus, t.newStatus]));

        s.setScopePipelines('A', [pipe(1, [{ id: 10, status: 'running' }])]);
        s.setScopePipelines('A', [pipe(1, [{ id: 10, status: 'running' }])]); // unchanged
        s.setScopePipelines('A', [pipe(1, [{ id: 10, status: 'success' }])]);

        expect(events).toEqual([
            [undefined, 'running'],
            ['running', 'success'],
        ]);
    });

    it('emits pipeline status transitions only on change', () => {
        const s = new PipelineStore();
        const events: Array<[unknown, string]> = [];
        s.onPipelineStatusChange(t => events.push([t.oldStatus, t.newStatus]));

        s.setScopePipelines('A', [pipe(1, [], 'running')]);
        s.setScopePipelines('A', [pipe(1, [], 'running')]);  // unchanged
        s.setScopePipelines('A', [pipe(1, [], 'failed')]);

        expect(events).toEqual([
            [undefined, 'running'],
            ['running', 'failed'],
        ]);
    });

    it('fires one pipeline transition even when the pipeline is in two scopes', () => {
        const s = new PipelineStore();
        let count = 0;
        s.onPipelineStatusChange(() => count++);
        s.setScopePipelines('A', [pipe(1, [], 'running')]);
        s.setScopePipelines('B', [pipe(1, [], 'running')]);
        expect(count).toBe(1);
    });

    it('scopeHasPipeline reflects membership', () => {
        const s = new PipelineStore();
        s.setScopePipelines('A', [pipe(1)]);
        expect(s.scopeHasPipeline('A', 1)).toBe(true);
        expect(s.scopeHasPipeline('B', 1)).toBe(false);
    });

    it('finds nested downstream jobs', () => {
        const s = new PipelineStore();
        const p = pipe(1, [{ id: 10, status: 'success' }]);
        p.jobs[0].children = [{
            id: 20, name: 'child', stage: 'c', status: 'failed', ref: 'main',
            webUrl: '', pipelineId: 2, projectId: 1, projectPath: 'g/p',
        }];
        s.setScopePipelines('A', [p]);
        expect(s.findJob(20)?.name).toBe('child');
    });

    it('prunes status tracking for entries that vanished everywhere', () => {
        const s = new PipelineStore();
        const events: Array<[unknown, string]> = [];
        s.onPipelineStatusChange(t => events.push([t.oldStatus, t.newStatus]));

        s.setScopePipelines('A', [pipe(1, [], 'running')]);
        s.setScopePipelines('A', [pipe(2, [], 'running')]);  // pipeline 1 gone
        s.setScopePipelines('A', [pipe(1, [], 'failed')]);   // 1 returns — tracked fresh

        expect(events).toEqual([
            [undefined, 'running'],   // 1 appears
            [undefined, 'running'],   // 2 appears
            [undefined, 'failed'],    // 1 re-appears with no stale old status
        ]);
    });
});

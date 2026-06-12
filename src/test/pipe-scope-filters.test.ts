import { describe, it, expect } from 'vitest';
import { applyScopeFilters, scopeToServerParams } from '../pipe/scope-filters';
import type { Pipeline, PipeScope } from '../pipe/models';

const P = (overrides: Partial<Pipeline>): Pipeline => ({
    id: 1, projectId: 1, projectPath: 'g/p', ref: 'main', sha: 'abc',
    status: 'success', webUrl: '', createdAt: '2024-01-01', updatedAt: '2024-01-01',
    jobs: [], ...overrides,
});

const S = (overrides: Partial<PipeScope>): PipeScope => ({
    id: 's1', label: 'test', projects: ['x'], enabled: true, follow: false, tags: [],
    ...overrides,
});

describe('applyScopeFilters', () => {
    it('matches branch case-insensitively', () => {
        const ps = [P({ ref: 'Develop', id: 1 }), P({ ref: 'main', id: 2 })];
        const out = applyScopeFilters(ps, S({ branchFilter: 'develop' }));
        expect(out.map(p => p.id)).toEqual([1]);
    });

    it('filters by status', () => {
        const ps = [P({ status: 'failed', id: 1 }), P({ status: 'success', id: 2 })];
        const out = applyScopeFilters(ps, S({ statusFilter: ['failed'] }));
        expect(out.map(p => p.id)).toEqual([1]);
    });

    it('filters by user case-insensitively', () => {
        const ps = [
            P({ user: { username: 'Alice' }, id: 1 }),
            P({ user: { username: 'bob' },   id: 2 }),
        ];
        const out = applyScopeFilters(ps, S({ userFilter: 'alice' }));
        expect(out.map(p => p.id)).toEqual([1]);
    });

    it('filters by sinceHours', () => {
        const now = Date.now();
        const old = new Date(now - 10 * 3600 * 1000).toISOString();
        const recent = new Date(now - 1 * 3600 * 1000).toISOString();
        const ps = [P({ updatedAt: old, id: 1 }), P({ updatedAt: recent, id: 2 })];
        const out = applyScopeFilters(ps, S({ sinceHours: 5 }));
        expect(out.map(p => p.id)).toEqual([2]);
    });

    it('caps to lastN', () => {
        const ps = [1, 2, 3, 4, 5].map(i => P({ id: i }));
        const out = applyScopeFilters(ps, S({ lastN: 3 }));
        expect(out.length).toBe(3);
    });

    it('matches nameContains on sha', () => {
        const ps = [P({ sha: 'aaaa1234', id: 1 }), P({ sha: 'bbbb', id: 2 })];
        const out = applyScopeFilters(ps, S({ nameContains: '1234' }));
        expect(out.map(p => p.id)).toEqual([1]);
    });
});

describe('scopeToServerParams', () => {
    it('builds per-page from lastN', () => {
        const r = scopeToServerParams(S({ lastN: 30 }));
        expect(r.perPage).toBe(60);
    });

    it('caps perPage at 100', () => {
        const r = scopeToServerParams(S({ lastN: 200 }));
        expect(r.perPage).toBe(100);
    });

    it('emits updated_after for sinceHours', () => {
        const r = scopeToServerParams(S({ sinceHours: 1 }));
        expect(r.updatedAfter).toBeDefined();
    });

    it('passes through ref and username', () => {
        const r = scopeToServerParams(S({ branchFilter: 'main', userFilter: 'alice' }));
        expect(r.ref).toBe('main');
        expect(r.username).toBe('alice');
    });
});

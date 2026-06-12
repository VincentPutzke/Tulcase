import { describe, it, expect } from 'vitest';
import { normalizeScope } from '../pipe/models';

describe('normalizeScope', () => {
    it('returns undefined without a usable project list', () => {
        expect(normalizeScope({}, 'f')).toBeUndefined();
        expect(normalizeScope({ projects: [] }, 'f')).toBeUndefined();
        expect(normalizeScope({ projects: [42, ''] }, 'f')).toBeUndefined();
        expect(normalizeScope(null, 'f')).toBeUndefined();
        expect(normalizeScope('nope', 'f')).toBeUndefined();
    });

    it('fills defaults for a minimal entry', () => {
        const s = normalizeScope({ projects: ['g/p'] }, 'fallback-id')!;
        expect(s).toEqual({
            id: 'fallback-id',
            label: 'g/p',
            projects: ['g/p'],
            enabled: true,
            follow: false,
            tags: [],
        });
    });

    it('keeps valid optional fields and trims strings', () => {
        const s = normalizeScope({
            id: 'abc',
            label: '  Backend  ',
            projects: [' g/p ', 'g/q'],
            enabled: false,
            follow: true,
            tags: ['#work', 7],
            branchFilter: ' develop ',
            statusFilter: ['failed', 'bogus', 'running'],
            userFilter: 'alice',
            nameContains: 'feat',
            sinceHours: 24,
            lastN: 7.9,
            logRules: ['strip-timestamps', ''],
        }, 'f')!;
        expect(s.id).toBe('abc');
        expect(s.label).toBe('Backend');
        expect(s.projects).toEqual(['g/p', 'g/q']);
        expect(s.enabled).toBe(false);
        expect(s.follow).toBe(true);
        expect(s.tags).toEqual(['#work']);
        expect(s.branchFilter).toBe('develop');
        expect(s.statusFilter).toEqual(['failed', 'running']);
        expect(s.userFilter).toBe('alice');
        expect(s.nameContains).toBe('feat');
        expect(s.sinceHours).toBe(24);
        expect(s.lastN).toBe(7);
        expect(s.logRules).toEqual(['strip-timestamps']);
    });

    it('drops wrong-typed optional fields silently', () => {
        const s = normalizeScope({
            projects: ['g/p'],
            branchFilter: 42,
            statusFilter: 'failed',
            sinceHours: -3,
            lastN: 0,
            logRules: 'strip',
        }, 'f')!;
        expect(s.branchFilter).toBeUndefined();
        expect(s.statusFilter).toBeUndefined();
        expect(s.sinceHours).toBeUndefined();
        expect(s.lastN).toBeUndefined();
        expect(s.logRules).toBeUndefined();
    });
});

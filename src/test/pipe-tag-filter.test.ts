import { describe, it, expect } from 'vitest';
import { scopeMatchesTags } from '../pipe/scope-filters';

const scope = (tags: string[]) => ({ tags });

describe('scopeMatchesTags — workspace-local tag filter inclusion', () => {
    it('passes every scope when no tags are selected', () => {
        expect(scopeMatchesTags(scope([]), [])).toBe(true);
        expect(scopeMatchesTags(scope(['frontend']), [])).toBe(true);
    });

    it('passes a scope that has at least one selected tag (OR semantics)', () => {
        expect(scopeMatchesTags(scope(['frontend', 'web']), ['frontend'])).toBe(true);
        expect(scopeMatchesTags(scope(['backend']), ['frontend', 'backend'])).toBe(true);
    });

    it('excludes a scope that has none of the selected tags', () => {
        expect(scopeMatchesTags(scope(['backend']), ['frontend'])).toBe(false);
    });

    it('excludes an untagged scope when a filter is active', () => {
        expect(scopeMatchesTags(scope([]), ['frontend'])).toBe(false);
    });
});

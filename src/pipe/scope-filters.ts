/**
 * Client-side scope filtering.  Server-side query parameters cover what the
 * GitLab API supports natively (status, ref, username, updated_after); these
 * helpers handle the rest and apply the deterministic `lastN` trim.
 */

import type { Pipeline, PipeScope } from './models';

export function applyScopeFilters(
    pipelines: ReadonlyArray<Pipeline>,
    scope: PipeScope,
): Pipeline[] {
    let filtered: ReadonlyArray<Pipeline> = pipelines;

    if (scope.statusFilter && scope.statusFilter.length > 0) {
        const allowed = new Set(scope.statusFilter);
        filtered = filtered.filter(p => allowed.has(p.status));
    }
    if (scope.branchFilter) {
        const want = scope.branchFilter.toLowerCase();
        filtered = filtered.filter(p => p.ref.toLowerCase() === want);
    }
    if (scope.userFilter) {
        const u = scope.userFilter.toLowerCase();
        filtered = filtered.filter(p => p.user?.username?.toLowerCase() === u);
    }
    if (scope.nameContains) {
        const needle = scope.nameContains.toLowerCase();
        filtered = filtered.filter(p =>
            p.ref.toLowerCase().includes(needle) ||
            p.sha.toLowerCase().includes(needle),
        );
    }
    if (scope.sinceHours && scope.sinceHours > 0) {
        const cutoff = Date.now() - scope.sinceHours * 3600 * 1000;
        filtered = filtered.filter(p => Date.parse(p.updatedAt) >= cutoff);
    }
    if (scope.lastN && scope.lastN > 0) {
        filtered = filtered.slice(0, scope.lastN);
    }
    return filtered.slice();
}

/** Build the most useful server-side params for a scope (per project). */
export function scopeToServerParams(scope: PipeScope): {
    perPage: number;
    ref?: string;
    username?: string;
    updatedAfter?: string;
} {
    const perPage = Math.min(100, Math.max(20, (scope.lastN ?? 20) * 2));
    const out: { perPage: number; ref?: string; username?: string; updatedAfter?: string } = { perPage };
    if (scope.branchFilter) { out.ref = scope.branchFilter; }
    if (scope.userFilter)   { out.username = scope.userFilter; }
    if (scope.sinceHours && scope.sinceHours > 0) {
        out.updatedAfter = new Date(Date.now() - scope.sinceHours * 3600 * 1000).toISOString();
    }
    return out;
}

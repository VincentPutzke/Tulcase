/**
 * Expand a scope's sources into the concrete project refs that Pipe should
 * poll: project sources pass through; group sources are enumerated (a single
 * paginated sweep, supplied by the caller), minus their exclusions, and the
 * whole set is deduped and bounded by a cap so one huge group can't flood the
 * poller (ticket 07).
 *
 * Pure (the group resolver + cap are injected) — unit-testable.
 */

import type { PipeSource } from './models';

export interface ExpandOptions {
    /** Resolve every project path under a group (recursive, single sweep). */
    listGroupProjects(groupRef: string): Promise<string[]>;
    /** Hard cap on the total expanded project count. */
    maxProjects: number;
}

export interface ExpandResult {
    /** Deduped project refs to poll, truncated to the cap. */
    projects: string[];
    /** True when the cap dropped some projects. */
    capped: boolean;
    /** How many projects were dropped by the cap. */
    omitted: number;
}

/**
 * True when `path` equals an exclude or sits under one (subtree prefix).
 * Canonical home for the exclusion rule — re-exported by the registry tree.
 */
export function isExcluded(path: string, excludes: readonly string[] | undefined): boolean {
    if (!excludes || excludes.length === 0) { return false; }
    return excludes.some(e => path === e || path.startsWith(e + '/'));
}

export async function expandScopeProjects(
    sources: readonly PipeSource[],
    opts: ExpandOptions,
): Promise<ExpandResult> {
    const seen = new Set<string>();
    let omitted = 0;
    // The cap bounds each GROUP source's expansion; explicit project sources
    // are always included and never dropped by it.
    const cap = Math.max(1, opts.maxProjects);

    for (const src of sources) {
        if (src.type === 'project') {
            seen.add(src.ref);
            continue;
        }
        // group source → enumerate, drop exclusions (and their subtrees),
        // then add up to `cap` NEW projects from this group.
        let projects: string[] = [];
        try {
            projects = await opts.listGroupProjects(src.ref);
        } catch {
            projects = [];   // a broken group must not fail the whole scope
        }
        let addedFromGroup = 0;
        for (const p of projects) {
            if (isExcluded(p, src.exclude) || seen.has(p)) { continue; }
            if (addedFromGroup >= cap) { omitted++; continue; }
            seen.add(p);
            addedFromGroup++;
        }
    }

    return { projects: [...seen], capped: omitted > 0, omitted };
}

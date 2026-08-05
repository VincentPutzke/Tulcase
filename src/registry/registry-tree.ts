/**
 * Pure builders for the Registry (Packages) browse tree.
 *
 * The tree is:
 *   scope → source → group/subgroup/project (folders) → package (by name+type)
 *         → version (leaf; downloading pulls all of the version's files).
 *
 * No VS Code or network here — the feature fetches data via the GitLab client
 * and feeds it to these functions, which apply exclusions and grouping. Fully
 * unit-testable (ticket 08/09 seam).
 */

import type { GitLabPackage, GroupHit, ProjectNode } from '../pipe/gitlab-client';
import type { PipeSource } from '../pipe/models';
import { isExcluded } from '../pipe/source-expansion';

/** Re-exported so registry consumers/tests keep a single import surface. */
export { isExcluded } from '../pipe/source-expansion';

export type RegistryNodeKind = 'scope' | 'group' | 'project' | 'package' | 'version';

export interface RegistryNode {
    /** Stable, path-like id (also the poller subscription key). */
    id: string;
    kind: RegistryNodeKind;
    label: string;
    /** Owning scope id (present on every node). */
    scopeId: string;
    /** Whether the node can be expanded to load children. */
    expandable: boolean;

    // Context carried for fetching children / downloading.
    groupRef?: string;          // group / source(group)
    /** Excludes inherited from the owning group source (subtree prefixes). */
    excludes?: string[];
    projectRef?: string;        // project / package / version
    packageId?: number;         // package / version
    packageName?: string;
    packageType?: string;
    version?: string;
    /** version only: true when the file(s) can be downloaded (generic in v1). */
    downloadable?: boolean;
}

/** A package name+type with its versions (grouped from the flat API rows). */
export interface PackageGroup {
    name: string;
    packageType: string;
    versions: Array<{ id: number; version: string }>;
}

/** Package types whose files v1 can download. */
export const DOWNLOADABLE_TYPES = new Set(['generic']);

// ── Package grouping ────────────────────────────────────────────────────────

/** Group flat name+version rows into name+type groups (stable, name-sorted). */
export function groupPackages(packages: readonly GitLabPackage[]): PackageGroup[] {
    const groups = new Map<string, PackageGroup>();
    for (const p of packages) {
        const key = `${p.name} ${p.packageType}`;
        let g = groups.get(key);
        if (!g) {
            g = { name: p.name, packageType: p.packageType, versions: [] };
            groups.set(key, g);
        }
        if (!g.versions.some(v => v.version === p.version)) {
            g.versions.push({ id: p.id, version: p.version });
        }
    }
    return [...groups.values()].sort((a, b) =>
        a.name.localeCompare(b.name) || a.packageType.localeCompare(b.packageType));
}

// ── Node builders ─────────────────────────────────────────────────────────────

/** Top-level nodes: one per registry-enabled scope (collapsed). */
export function buildScopeNodes(
    scopes: ReadonlyArray<{ id: string; label: string; registryEnabled: boolean; sources: PipeSource[] }>,
): RegistryNode[] {
    return scopes
        .filter(s => s.registryEnabled && s.sources.length > 0)
        .map(s => ({
            id: `scope:${s.id}`,
            kind: 'scope' as const,
            label: s.label,
            scopeId: s.id,
            expandable: true,
        }));
}

/** Children of a scope node: one folder per source. */
export function buildSourceNodes(scopeId: string, sources: readonly PipeSource[]): RegistryNode[] {
    return sources.map(src => src.type === 'group'
        ? {
            id: `scope:${scopeId}/group:${src.ref}`,
            kind: 'group' as const,
            label: src.ref,
            scopeId,
            groupRef: src.ref,
            excludes: src.exclude ?? [],
            expandable: true,
        }
        : {
            id: `scope:${scopeId}/project:${src.ref}`,
            kind: 'project' as const,
            label: src.ref,
            scopeId,
            projectRef: src.ref,
            expandable: true,
        });
}

/**
 * Children of a group node: subgroups then projects as folders, with excluded
 * paths (and their subtrees) removed. `parentId` seeds child ids so the same
 * project under two scopes has distinct, stable node ids.
 */
export function buildGroupChildren(
    parent: RegistryNode,
    subgroups: readonly GroupHit[],
    projects: readonly ProjectNode[],
): RegistryNode[] {
    const excludes = parent.excludes ?? [];
    const nodes: RegistryNode[] = [];
    for (const g of subgroups) {
        if (isExcluded(g.fullPath, excludes)) { continue; }
        nodes.push({
            id: `${parent.id}/group:${g.fullPath}`,
            kind: 'group',
            label: g.name,
            scopeId: parent.scopeId,
            groupRef: g.fullPath,
            excludes,                       // excludes propagate down the subtree
            expandable: true,
        });
    }
    for (const p of projects) {
        if (isExcluded(p.pathWithNamespace, excludes)) { continue; }
        nodes.push({
            id: `${parent.id}/project:${p.pathWithNamespace}`,
            kind: 'project',
            label: p.name,
            scopeId: parent.scopeId,
            projectRef: p.pathWithNamespace,
            expandable: true,
        });
    }
    return nodes;
}

/** Stable node id of a package (name+type) under a project node. */
export function packageNodeId(parentId: string, group: Pick<PackageGroup, 'name' | 'packageType'>): string {
    return `${parentId}/pkg:${group.name} ${group.packageType}`;
}

/** Children of a project node: one package node per name+type. */
export function buildPackageNodes(parent: RegistryNode, packages: readonly GitLabPackage[]): RegistryNode[] {
    const projectRef = parent.projectRef!;
    return groupPackages(packages).map(g => ({
        id: packageNodeId(parent.id, g),
        kind: 'package' as const,
        label: `${g.name} (${g.packageType})`,
        scopeId: parent.scopeId,
        projectRef,
        packageName: g.name,
        packageType: g.packageType,
        expandable: g.versions.length > 0,
    }));
}

/**
 * Children of a package node: one version leaf per version. Built from the
 * already-fetched project packages (no extra request), so callers pass the
 * matching {@link PackageGroup}.
 */
export function buildVersionNodes(parent: RegistryNode, group: PackageGroup): RegistryNode[] {
    const downloadable = DOWNLOADABLE_TYPES.has(group.packageType);
    return group.versions.map(v => ({
        id: `${parent.id}/ver:${v.version}`,
        kind: 'version' as const,
        label: v.version,
        scopeId: parent.scopeId,
        projectRef: parent.projectRef,
        packageId: v.id,
        packageName: group.name,
        packageType: group.packageType,
        version: v.version,
        expandable: false,
        downloadable,
    }));
}

/**
 * Fetches the children of a Registry tree node, translating GitLab API rows
 * into {@link RegistryNode}s via the pure tree builders.
 *
 *   scope   → source folders            (from the scope store, no network)
 *   group   → subgroups + projects       (one cached enumeration per group ref)
 *   project → packages grouped by name   (fresh each load, so new packages show)
 *   package → version leaves             (from the already-fetched project rows)
 *
 * Group enumeration is memoised in a TTL cache (ticket 11: "group-tree cache has
 * a TTL plus manual invalidation") so expanding/polling doesn't re-walk it every
 * tick; package listing is intentionally NOT long-cached so background polling
 * surfaces newly published packages. `invalidate()` clears both for a node.
 */

import type { GitLabClient, GroupHit, ProjectNode } from '../pipe/gitlab-client';
import type { PipeScopeStore } from '../pipe/scope-store';
import { TtlCache } from '../pipe/ttl-cache';
import {
    buildSourceNodes,
    buildGroupChildren,
    buildPackageNodes,
    buildVersionNodes,
    groupPackages,
    packageNodeId,
    type RegistryNode,
    type PackageGroup,
} from './registry-tree';
import { isSelfOrDescendant } from './node-id';

/** How long a group's raw subgroup/project enumeration stays fresh. */
export const GROUP_TREE_TTL_MS = 5 * 60 * 1000;

export class RegistryService {
    /** Raw group enumeration (exclude-independent) memoised by group ref. */
    private readonly _groupTree = new TtlCache<{ subgroups: GroupHit[]; projects: ProjectNode[] }>(
        GROUP_TREE_TTL_MS,
    );
    /** Package group per package node id → build versions with no extra request. */
    private readonly _packageGroups = new Map<string, PackageGroup>();

    constructor(
        private readonly client: GitLabClient,
        private readonly scopes: PipeScopeStore,
    ) {}

    /** Load the children of `node`. Throws on a network/API error (the caller
     *  records an expand-error state so the view can offer a retry). */
    async loadChildren(node: RegistryNode, signal?: AbortSignal): Promise<RegistryNode[]> {
        switch (node.kind) {
            case 'scope': {
                const scope = await this.scopes.getScope(node.scopeId);
                if (!scope) { return []; }
                const sourceNodes = buildSourceNodes(scope.id, scope.sources);
                if (sourceNodes.length !== 1) { return sourceNodes; }

                const source = { ...sourceNodes[0], id: node.id };
                if (source.kind === 'group') { return this._loadGroupChildren(source, signal); }
                if (source.kind === 'project') { return this._loadProjectPackages(source, signal); }
                return sourceNodes;
            }
            case 'group': {
                return this._loadGroupChildren(node, signal);
            }
            case 'project':
                return this._loadProjectPackages(node, signal);
            case 'package': {
                // Normally the version set was cached when the project loaded.
                // If it's missing (e.g. a manual refresh dropped it), re-fetch
                // the project's packages so refreshing a package node rebuilds
                // its versions instead of blanking them.
                if (!this._packageGroups.has(node.id)) {
                    const parentId = node.id.slice(0, node.id.lastIndexOf('/'));
                    await this._loadProjectPackages(
                        { ...node, id: parentId, kind: 'project' }, signal,
                    );
                }
                const group = this._packageGroups.get(node.id);
                return group ? buildVersionNodes(node, group) : [];
            }
            default:
                return [];
        }
    }

    /** Fetch a group's subgroup/project folders with TTL-cached enumeration. */
    private async _loadGroupChildren(node: RegistryNode, signal?: AbortSignal): Promise<RegistryNode[]> {
        const groupRef = node.groupRef!;
        const { subgroups, projects } = await this._groupTree.get(groupRef, async () => {
            const [subgroups, projects] = await Promise.all([
                this.client.listSubgroups(groupRef, signal),
                this.client.listGroupProjects(groupRef, false, signal),
            ]);
            return { subgroups, projects };
        });
        return buildGroupChildren(node, subgroups, projects);
    }

    /** Fetch a project's packages → package nodes, caching each version set. */
    private async _loadProjectPackages(node: RegistryNode, signal?: AbortSignal): Promise<RegistryNode[]> {
        const pkgs = await this.client.listProjectPackages(node.projectRef!, signal);
        const nodes = buildPackageNodes(node, pkgs);
        // Remember each package's version set so expanding it needs no refetch.
        for (const g of groupPackages(pkgs)) {
            this._packageGroups.set(packageNodeId(node.id, g), g);
        }
        return nodes;
    }

    /** Manual refresh of a node: drop its cached enumeration + package groups. */
    invalidate(node: RegistryNode): void {
        if (node.groupRef) { this._groupTree.invalidate(node.groupRef); }
        for (const id of [...this._packageGroups.keys()]) {
            if (isSelfOrDescendant(id, node.id)) { this._packageGroups.delete(id); }
        }
    }

    /** Global refresh: clear all cached enumeration + package groups. */
    invalidateAll(): void {
        this._groupTree.invalidate();
        this._packageGroups.clear();
    }
}

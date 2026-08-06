import { describe, it, expect } from 'vitest';
import {
    isExcluded,
    groupPackages,
    buildScopeNodes,
    buildSourceNodes,
    buildGroupChildren,
    buildPackageNodes,
    buildVersionNodes,
    type RegistryNode,
    type PackageGroup,
} from '../registry/registry-tree';
import type { GitLabPackage, GroupHit, ProjectNode } from '../pipe/gitlab-client';
import type { PipeSource } from '../pipe/models';

describe('isExcluded — subtree prefix', () => {
    it('excludes the exact path and everything under it', () => {
        const ex = ['acme/backend/legacy'];
        expect(isExcluded('acme/backend/legacy', ex)).toBe(true);
        expect(isExcluded('acme/backend/legacy/util', ex)).toBe(true);
        expect(isExcluded('acme/backend/legacyish', ex)).toBe(false);  // not a subtree
        expect(isExcluded('acme/backend/api', ex)).toBe(false);
    });
    it('is false with no excludes', () => {
        expect(isExcluded('a/b', undefined)).toBe(false);
        expect(isExcluded('a/b', [])).toBe(false);
    });
});

describe('groupPackages', () => {
    const pkg = (name: string, version: string, id: number, type = 'generic'): GitLabPackage =>
        ({ id, name, version, packageType: type, status: 'default' });

    it('groups by name+type and collects versions, name-sorted', () => {
        const groups = groupPackages([
            pkg('zlib', '1.0.0', 1), pkg('acme', '2.0.0', 2), pkg('acme', '1.0.0', 3),
        ]);
        expect(groups.map(g => g.name)).toEqual(['acme', 'zlib']);
        expect(groups[0].versions.map(v => v.version)).toEqual(['2.0.0', '1.0.0']);
    });

    it('keeps same name under different types as separate groups', () => {
        const groups = groupPackages([pkg('foo', '1', 1, 'generic'), pkg('foo', '1', 2, 'npm')]);
        expect(groups).toHaveLength(2);
        expect(groups.map(g => g.packageType).sort()).toEqual(['generic', 'npm']);
    });
});

describe('node builders', () => {
    const scope = (o: Partial<{ id: string; label: string; registryEnabled: boolean; sources: PipeSource[]; tags: string[] }> = {}) => ({
        id: 's1', label: 'Backend', registryEnabled: true,
        sources: [{ type: 'group', ref: 'acme/backend' }] as PipeSource[], ...o,
    });

    it('buildScopeNodes lists only registry-enabled scopes with sources', () => {
        const nodes = buildScopeNodes([
            scope(),
            scope({ id: 's2', registryEnabled: false }),
            scope({ id: 's3', sources: [] }),
        ]);
        expect(nodes.map(n => n.scopeId)).toEqual(['s1']);
        expect(nodes[0]).toMatchObject({ kind: 'scope', expandable: true });
    });

    it('buildScopeNodes carries scope tags for root headers', () => {
        const nodes = buildScopeNodes([scope({ tags: ['release', 'backend'] })]);
        expect(nodes[0].tags).toEqual(['release', 'backend']);
    });

    it('buildSourceNodes makes group + project folders', () => {
        const nodes = buildSourceNodes('s1', [
            { type: 'group', ref: 'acme/backend', exclude: ['acme/backend/legacy'] },
            { type: 'project', ref: 'acme/tools/cli' },
        ]);
        expect(nodes[0]).toMatchObject({ kind: 'group', groupRef: 'acme/backend', excludes: ['acme/backend/legacy'] });
        expect(nodes[1]).toMatchObject({ kind: 'project', projectRef: 'acme/tools/cli' });
    });

    it('buildGroupChildren prunes excluded subgroups/projects and propagates excludes', () => {
        const parent: RegistryNode = {
            id: 'scope:s1/group:acme/backend', kind: 'group', label: 'backend',
            scopeId: 's1', groupRef: 'acme/backend', excludes: ['acme/backend/legacy'], expandable: true,
        };
        const subgroups: GroupHit[] = [
            { id: 1, fullPath: 'acme/backend/libs', name: 'libs' },
            { id: 2, fullPath: 'acme/backend/legacy', name: 'legacy' },     // excluded
        ];
        const projects: ProjectNode[] = [
            { id: 10, pathWithNamespace: 'acme/backend/api', name: 'api' },
            { id: 11, pathWithNamespace: 'acme/backend/legacy/old', name: 'old' },  // excluded subtree
        ];
        const children = buildGroupChildren(parent, subgroups, projects);
        expect(children.map(c => c.label)).toEqual(['libs', 'api']);
        expect(children[0].excludes).toEqual(['acme/backend/legacy']);   // propagated down
        expect(children[0].id).toBe('scope:s1/group:acme/backend/group:acme/backend/libs');
    });

    it('buildPackageNodes + buildVersionNodes; generic is downloadable, others not', () => {
        const project: RegistryNode = {
            id: 'scope:s1/project:acme/api', kind: 'project', label: 'api',
            scopeId: 's1', projectRef: 'acme/api', expandable: true,
        };
        const pkgs: GitLabPackage[] = [
            { id: 1, name: 'app', version: '1.0.0', packageType: 'generic', status: 'default' },
            { id: 2, name: 'app', version: '1.1.0', packageType: 'generic', status: 'default' },
            { id: 3, name: 'lib', version: '9.9', packageType: 'npm', status: 'default' },
        ];
        const pkgNodes = buildPackageNodes(project, pkgs);
        expect(pkgNodes.map(n => n.packageName)).toEqual(['app', 'lib']);

        const appGroup: PackageGroup = {
            name: 'app', packageType: 'generic',
            versions: [{ id: 2, version: '1.1.0' }, { id: 1, version: '1.0.0' }],
        };
        const versions = buildVersionNodes(pkgNodes[0], appGroup);
        expect(versions.map(v => v.version)).toEqual(['1.1.0', '1.0.0']);
        expect(versions[0]).toMatchObject({ kind: 'version', downloadable: true, packageId: 2, expandable: false });

        const npmGroup: PackageGroup = { name: 'lib', packageType: 'npm', versions: [{ id: 3, version: '9.9' }] };
        expect(buildVersionNodes(pkgNodes[1], npmGroup)[0].downloadable).toBe(false);
    });
});

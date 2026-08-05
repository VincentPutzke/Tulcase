import { describe, it, expect, vi } from 'vitest';
import { RegistryService } from '../registry/registry-service';
import type { GitLabClient, GroupHit, ProjectNode, GitLabPackage } from '../pipe/gitlab-client';
import type { PipeScopeStore } from '../pipe/scope-store';
import type { RegistryNode } from '../registry/registry-tree';

function fakeClient(over: Partial<GitLabClient> = {}): GitLabClient {
    return {
        listSubgroups: vi.fn(async (): Promise<GroupHit[]> => []),
        listGroupProjects: vi.fn(async (): Promise<ProjectNode[]> => []),
        listProjectPackages: vi.fn(async (): Promise<GitLabPackage[]> => []),
        ...over,
    } as unknown as GitLabClient;
}

function fakeScopes(scope: unknown): PipeScopeStore {
    return { getScope: vi.fn(async () => scope) } as unknown as PipeScopeStore;
}

describe('RegistryService.loadChildren', () => {
    it('scope → source folders (from the scope store, no network)', async () => {
        const svc = new RegistryService(fakeClient(), fakeScopes({
            id: 's1', sources: [
                { type: 'group', ref: 'acme/backend', exclude: ['acme/backend/legacy'] },
                { type: 'project', ref: 'acme/cli' },
            ],
        }));
        const node: RegistryNode = { id: 'scope:s1', kind: 'scope', label: 'B', scopeId: 's1', expandable: true };
        const kids = await svc.loadChildren(node);
        expect(kids.map(k => k.kind)).toEqual(['group', 'project']);
        expect(kids[0].excludes).toEqual(['acme/backend/legacy']);
    });

    it('scope with a single group source loads that source directly', async () => {
        const client = fakeClient({
            listSubgroups: vi.fn(async () => [
                { id: 1, fullPath: 'acme/backend/libs', name: 'libs' },
            ]),
            listGroupProjects: vi.fn(async () => [
                { id: 10, pathWithNamespace: 'acme/backend/api', name: 'api' },
            ]),
        });
        const svc = new RegistryService(client, fakeScopes({
            id: 's1',
            sources: [{ type: 'group', ref: 'acme/backend', exclude: ['acme/backend/legacy'] }],
        }));
        const node: RegistryNode = { id: 'scope:s1', kind: 'scope', label: 'B', scopeId: 's1', expandable: true };
        const kids = await svc.loadChildren(node);
        expect(kids.map(k => k.kind)).toEqual(['group', 'project']);
        expect(kids.map(k => k.label)).toEqual(['libs', 'api']);
        expect(kids[0].id).toBe('scope:s1/group:acme/backend/libs');
        expect(client.listGroupProjects).toHaveBeenCalledWith('acme/backend', false, undefined);
    });

    it('scope with a single project source loads packages directly', async () => {
        const client = fakeClient({
            listProjectPackages: vi.fn(async () => [
                { id: 1, name: 'app', version: '1.0.0', packageType: 'generic', status: 'default' },
            ]),
        });
        const svc = new RegistryService(client, fakeScopes({
            id: 's1',
            sources: [{ type: 'project', ref: 'acme/backend/api' }],
        }));
        const node: RegistryNode = { id: 'scope:s1', kind: 'scope', label: 'B', scopeId: 's1', expandable: true };
        const kids = await svc.loadChildren(node);
        expect(kids).toHaveLength(1);
        expect(kids[0]).toMatchObject({
            kind: 'package',
            id: 'scope:s1/pkg:app generic',
            projectRef: 'acme/backend/api',
        });
    });

    it('group → subgroups + projects, exclusions pruned', async () => {
        const client = fakeClient({
            listSubgroups: vi.fn(async () => [
                { id: 1, fullPath: 'acme/backend/libs', name: 'libs' },
                { id: 2, fullPath: 'acme/backend/legacy', name: 'legacy' },
            ]),
            listGroupProjects: vi.fn(async () => [
                { id: 10, pathWithNamespace: 'acme/backend/api', name: 'api' },
            ]),
        });
        const svc = new RegistryService(client, fakeScopes(undefined));
        const node: RegistryNode = {
            id: 'scope:s1/group:acme/backend', kind: 'group', label: 'backend',
            scopeId: 's1', groupRef: 'acme/backend', excludes: ['acme/backend/legacy'], expandable: true,
        };
        const kids = await svc.loadChildren(node);
        expect(kids.map(k => k.label)).toEqual(['libs', 'api']);   // legacy pruned
        // group enumeration is exclude-independent → not called with subgroups=true
        expect(client.listGroupProjects).toHaveBeenCalledWith('acme/backend', false, undefined);
    });

    it('memoises group enumeration (TTL) and re-fetches after invalidate', async () => {
        const client = fakeClient({
            listSubgroups: vi.fn(async () => []),
            listGroupProjects: vi.fn(async () => []),
        });
        const svc = new RegistryService(client, fakeScopes(undefined));
        const node: RegistryNode = {
            id: 'scope:s1/group:g', kind: 'group', label: 'g', scopeId: 's1', groupRef: 'g', excludes: [], expandable: true,
        };
        await svc.loadChildren(node);
        await svc.loadChildren(node);
        expect(client.listSubgroups).toHaveBeenCalledTimes(1);   // cached

        svc.invalidate(node);
        await svc.loadChildren(node);
        expect(client.listSubgroups).toHaveBeenCalledTimes(2);   // refetched
    });

    it('project → packages, then package → versions with no extra request', async () => {
        const client = fakeClient({
            // The client returns newest-first (order_by=created_at&sort=desc).
            listProjectPackages: vi.fn(async () => [
                { id: 2, name: 'app', version: '1.1.0', packageType: 'generic', status: 'default' },
                { id: 1, name: 'app', version: '1.0.0', packageType: 'generic', status: 'default' },
            ]),
        });
        const svc = new RegistryService(client, fakeScopes(undefined));
        const project: RegistryNode = {
            id: 'scope:s1/project:acme/app', kind: 'project', label: 'app',
            scopeId: 's1', projectRef: 'acme/app', expandable: true,
        };
        const pkgs = await svc.loadChildren(project);
        expect(pkgs).toHaveLength(1);
        expect(pkgs[0].kind).toBe('package');

        const versions = await svc.loadChildren(pkgs[0]);
        expect(versions.map(v => v.version)).toEqual(['1.1.0', '1.0.0']);
        expect(client.listProjectPackages).toHaveBeenCalledTimes(1);   // versions came from cache
    });

    it('refreshing a package node re-fetches its project and rebuilds versions', async () => {
        const client = fakeClient({
            listProjectPackages: vi.fn(async () => [
                { id: 2, name: 'app', version: '1.1.0', packageType: 'generic', status: 'default' },
            ]),
        });
        const svc = new RegistryService(client, fakeScopes(undefined));
        const project: RegistryNode = {
            id: 'scope:s1/project:acme/app', kind: 'project', label: 'app',
            scopeId: 's1', projectRef: 'acme/app', expandable: true,
        };
        const pkgs = await svc.loadChildren(project);
        // Manual per-node refresh drops the package's cached version set…
        svc.invalidate(pkgs[0]);
        // …but expanding it again must re-fetch the project, not return empty.
        const versions = await svc.loadChildren(pkgs[0]);
        expect(versions.map(v => v.version)).toEqual(['1.1.0']);
        expect(client.listProjectPackages).toHaveBeenCalledTimes(2);
    });
});

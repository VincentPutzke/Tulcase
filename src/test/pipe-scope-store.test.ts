import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PipeScopeStore, normalizeScopeFile } from '../pipe/scope-store';
import type { PipeScope } from '../pipe/models';

let dir: string;
let store: PipeScopeStore;

const scope = (overrides: Partial<PipeScope> = {}): PipeScope => ({
    id: '', label: 'Test', projects: ['g/p'], enabled: true, follow: false, tags: [],
    ...overrides,
});

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tulcase-pipe-test-'));
    store = new PipeScopeStore({ pipeScopesFile: path.join(dir, 'scopes.json') });
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('PipeScopeStore — scopes', () => {
    it('starts empty and creates the file on first read', async () => {
        expect(await store.listScopes()).toEqual([]);
        expect(fs.existsSync(path.join(dir, 'scopes.json'))).toBe(true);
    });

    it('upserts new scopes with a generated id', async () => {
        const saved = await store.upsertScope(scope());
        expect(saved.id).toMatch(/^scope_/);
        const all = await store.listScopes();
        expect(all).toHaveLength(1);
        expect(all[0].label).toBe('Test');
    });

    it('updates an existing scope by id', async () => {
        const saved = await store.upsertScope(scope());
        await store.upsertScope({ ...saved, label: 'Renamed' });
        const all = await store.listScopes();
        expect(all).toHaveLength(1);
        expect(all[0].label).toBe('Renamed');
    });

    it('rejects scopes without projects', async () => {
        await expect(store.upsertScope(scope({ projects: [] })))
            .rejects.toThrow(/at least one project/);
    });

    it('removes scopes', async () => {
        const saved = await store.upsertScope(scope());
        expect(await store.removeScope(saved.id)).toBe(true);
        expect(await store.listScopes()).toEqual([]);
        expect(await store.removeScope('missing')).toBe(false);
    });

    it('duplicates a scope right below the original, without follow', async () => {
        const a = await store.upsertScope(scope({ label: 'A', follow: true }));
        await store.upsertScope(scope({ label: 'B' }));
        const copy = await store.duplicateScope(a.id);
        expect(copy?.label).toBe('A (copy)');
        expect(copy?.follow).toBe(false);
        const labels = (await store.listScopes()).map(s => s.label);
        expect(labels).toEqual(['A', 'A (copy)', 'B']);
    });

    it('moves scopes up and down with boundary checks', async () => {
        const a = await store.upsertScope(scope({ label: 'A' }));
        const b = await store.upsertScope(scope({ label: 'B' }));
        expect(await store.moveScope(a.id, 'up')).toBe(false);
        expect(await store.moveScope(b.id, 'up')).toBe(true);
        expect((await store.listScopes()).map(s => s.label)).toEqual(['B', 'A']);
    });

    it('patches follow / enabled / tags', async () => {
        const a = await store.upsertScope(scope());
        await store.setFollow(a.id, true);
        await store.setEnabled(a.id, false);
        await store.setTags(a.id, ['#x']);
        const fresh = await store.getScope(a.id);
        expect(fresh?.follow).toBe(true);
        expect(fresh?.enabled).toBe(false);
        expect(fresh?.tags).toEqual(['#x']);
    });

    it('fires onDidChange on writes', async () => {
        let fired = 0;
        store.onDidChange(() => fired++);
        await store.upsertScope(scope());
        expect(fired).toBe(1);
    });
});

describe('PipeScopeStore — custom rules', () => {
    it('upserts and removes rules, detaching them from scopes', async () => {
        const a = await store.upsertScope(scope({ logRules: ['my-rule'] }));
        await store.upsertRule({ name: 'my-rule', pattern: 'x', mode: 'remove' });
        expect(await store.customRules()).toHaveLength(1);

        expect(await store.removeRule('my-rule')).toBe(true);
        expect(await store.customRules()).toEqual([]);
        const fresh = await store.getScope(a.id);
        expect(fresh?.logRules).toBeUndefined();
    });

    it('keeps scope references when removing an override of a built-in', async () => {
        const a = await store.upsertScope(scope({ logRules: ['strip-timestamps'] }));
        await store.upsertRule({ name: 'strip-timestamps', pattern: 'y', mode: 'remove' });
        await store.removeRule('strip-timestamps');
        const fresh = await store.getScope(a.id);
        expect(fresh?.logRules).toEqual(['strip-timestamps']);
    });

    it('rejects invalid rules', async () => {
        await expect(store.upsertRule({ name: 'bad', pattern: '(open', mode: 'remove' }))
            .rejects.toThrow(/Invalid regex/);
    });
});

describe('PipeScopeStore — legacy import', () => {
    it('imports the legacy flat-array format', async () => {
        const result = await store.importLegacy([
            { label: 'Old', projects: ['g/p'], branchFilter: 'main' },
            { projects: [] },  // invalid → skipped
        ]);
        expect(result.scopes).toBe(1);
        const all = await store.listScopes();
        expect(all[0].label).toBe('Old');
        expect(all[0].branchFilter).toBe('main');
    });

    it('imports the object format with rules and skips duplicates', async () => {
        const payload = {
            scopes: [{ label: 'Old', projects: ['g/p'] }],
            logRules: [{ name: 'r', pattern: 'x', mode: 'remove' }],
        };
        const first = await store.importLegacy(payload);
        expect(first).toEqual({ scopes: 1, rules: 1 });
        const second = await store.importLegacy(payload);
        expect(second).toEqual({ scopes: 0, rules: 0 });
    });
});

describe('normalizeScopeFile', () => {
    it('tolerates garbage input', () => {
        expect(normalizeScopeFile(null)).toEqual({ scopes: [], logRules: [] });
        expect(normalizeScopeFile('x')).toEqual({ scopes: [], logRules: [] });
        expect(normalizeScopeFile({ scopes: 'no', logRules: 12 }))
            .toEqual({ scopes: [], logRules: [] });
    });

    it('re-generates duplicate scope ids', () => {
        const out = normalizeScopeFile({
            scopes: [
                { id: 'dup', projects: ['a'] },
                { id: 'dup', projects: ['b'] },
            ],
        });
        expect(out.scopes).toHaveLength(2);
        expect(out.scopes[0].id).not.toBe(out.scopes[1].id);
    });

    it('drops duplicate and malformed rules', () => {
        const out = normalizeScopeFile({
            logRules: [
                { name: 'a', pattern: 'x', mode: 'remove' },
                { name: 'a', pattern: 'y', mode: 'remove' },
                { name: '', pattern: 'z', mode: 'remove' },
                { name: 'b' },
            ],
        });
        expect(out.logRules).toHaveLength(1);
        expect(out.logRules[0].pattern).toBe('x');
    });
});

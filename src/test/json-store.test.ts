import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JsonStore } from '../data/json-store';

describe('JsonStore', () => {
    let tmpDir: string;
    let store: JsonStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tulcase-test-'));
        store = new JsonStore();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('reads existing JSON file', async () => {
        const filePath = path.join(tmpDir, 'test.json');
        fs.writeFileSync(filePath, JSON.stringify({ items: [1, 2, 3] }));

        const result = await store.read(filePath, { items: [] });
        expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('returns default when file missing', async () => {
        const filePath = path.join(tmpDir, 'nonexistent.json');
        const result = await store.read(filePath, { items: [] });
        expect(result).toEqual({ items: [] });
    });

    it('creates parent directories on write', async () => {
        const filePath = path.join(tmpDir, 'deep', 'nested', 'data.json');
        await store.write(filePath, { hello: 'world' });

        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(content).toEqual({ hello: 'world' });
    });

    it('writes pretty-printed JSON', async () => {
        const filePath = path.join(tmpDir, 'pretty.json');
        await store.write(filePath, { a: 1 });

        const raw = fs.readFileSync(filePath, 'utf-8');
        expect(raw).toBe('{\n  "a": 1\n}');
    });

    it('handles empty file gracefully', async () => {
        const filePath = path.join(tmpDir, 'empty.json');
        fs.writeFileSync(filePath, '');

        const result = await store.read(filePath, { fallback: true });
        expect(result).toEqual({ fallback: true });
    });

    it('handles corrupt JSON gracefully', async () => {
        const filePath = path.join(tmpDir, 'corrupt.json');
        fs.writeFileSync(filePath, '{invalid json');

        const result = await store.read(filePath, { fallback: true });
        expect(result).toEqual({ fallback: true });
    });

    it('creates file with default when missing', async () => {
        const filePath = path.join(tmpDir, 'auto', 'created.json');
        await store.read(filePath, { default: 'value' });

        expect(fs.existsSync(filePath)).toBe(true);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(content).toEqual({ default: 'value' });
    });
});

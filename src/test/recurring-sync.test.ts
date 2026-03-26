import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { syncRecurringTodos } from '../data/recurring-sync';
import { buildSettings } from '../config';
import type { TulcaseSettings } from '../config';

import { vi } from 'vitest';
vi.mock('vscode', () => ({
    workspace: { getConfiguration: () => ({ get: () => '' }) },
}));

describe('Recurring Sync', () => {
    let tmpDir: string;
    let settings: TulcaseSettings;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tulcase-recurring-test-'));
        settings = buildSettings(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('daily schedule matches every day', async () => {
        seedRecurring(settings, [
            { id: 'r1', note: 'Daily standup', tags: [], schedule: { type: 'daily' }, active: true, instances: {} },
        ]);
        seedTodos(settings, []);

        const result = await syncRecurringTodos(settings, new Date(2026, 2, 16)); // Monday
        expect(result.items.length).toBe(1);
        expect(result.items[0].note).toBe('Daily standup');
    });

    it('weekly schedule matches correct weekday', async () => {
        // Monday = 1 in JS getDay()
        seedRecurring(settings, [
            { id: 'r1', note: 'Monday sync', tags: [], schedule: { type: 'weekly', weekdays: [1] }, active: true, instances: {} },
        ]);
        seedTodos(settings, []);

        const result = await syncRecurringTodos(settings, new Date(2026, 2, 16)); // Monday
        expect(result.items.length).toBe(1);
    });

    it('weekly schedule skips wrong weekday', async () => {
        seedRecurring(settings, [
            { id: 'r1', note: 'Monday sync', tags: [], schedule: { type: 'weekly', weekdays: [1] }, active: true, instances: {} },
        ]);
        seedTodos(settings, []);

        const result = await syncRecurringTodos(settings, new Date(2026, 2, 17)); // Tuesday
        expect(result.items.length).toBe(0);
    });

    it('idempotent: no duplicate todo on second run', async () => {
        seedRecurring(settings, [
            { id: 'r1', note: 'Daily standup', tags: [], schedule: { type: 'daily' }, active: true, instances: {} },
        ]);
        seedTodos(settings, []);

        await syncRecurringTodos(settings, new Date(2026, 2, 16));
        const result = await syncRecurringTodos(settings, new Date(2026, 2, 16));
        expect(result.items.length).toBe(1); // Still just one
    });

    it('inactive actions are skipped', async () => {
        seedRecurring(settings, [
            { id: 'r1', note: 'Inactive', tags: [], schedule: { type: 'daily' }, active: false, instances: {} },
        ]);
        seedTodos(settings, []);

        const result = await syncRecurringTodos(settings, new Date(2026, 2, 16));
        expect(result.items.length).toBe(0);
    });

    it('creates todo with correct tags', async () => {
        seedRecurring(settings, [
            { id: 'r1', note: 'Tagged task', tags: ['#work', '#daily'], schedule: { type: 'daily' }, active: true, instances: {} },
        ]);
        seedTodos(settings, []);

        const result = await syncRecurringTodos(settings, new Date(2026, 2, 16));
        expect(result.items[0].tags).toEqual(['#work', '#daily']);
    });

    it('respects lastCreatedDate', async () => {
        seedRecurring(settings, [
            { id: 'r1', note: 'Daily', tags: [], schedule: { type: 'daily' }, active: true, lastCreatedDate: '2026-03-16', instances: {} },
        ]);
        seedTodos(settings, []);

        const result = await syncRecurringTodos(settings, new Date(2026, 2, 16));
        expect(result.items.length).toBe(0); // Already created today
    });

    it('monthly schedule matches weekday + week-of-month', async () => {
        // March 16, 2026 is Monday, 3rd week of month
        seedRecurring(settings, [
            { id: 'r1', note: 'Monthly Monday W3', tags: [], schedule: { type: 'monthly', weekdays: [1], weeks: [3] }, active: true, instances: {} },
        ]);
        seedTodos(settings, []);

        const result = await syncRecurringTodos(settings, new Date(2026, 2, 16));
        expect(result.items.length).toBe(1);
    });
});

function seedRecurring(settings: TulcaseSettings, actions: unknown[]): void {
    fs.mkdirSync(path.dirname(settings.recurringFile), { recursive: true });
    fs.writeFileSync(settings.recurringFile, JSON.stringify({ actions }, null, 2));
}

function seedTodos(settings: TulcaseSettings, items: unknown[]): void {
    fs.mkdirSync(path.dirname(settings.todosFile), { recursive: true });
    fs.writeFileSync(settings.todosFile, JSON.stringify({ items }, null, 2));
}

import type { ArbeitsplatzSettings } from '../config';
import { JsonStore } from './json-store';
import { formatDate } from './time-utils';
import type { TodoStore, TodoItem } from '../models/todo.model';
import type { RecurringStore, RecurringAction, RecurringSchedule } from '../models/recurring.model';

const store = new JsonStore();

/**
 * Generate due recurring TODOs for the given day (default: today).
 * Idempotent — skips if already created for that day.
 */
export async function syncRecurringTodos(
    settings: ArbeitsplatzSettings,
    today?: Date
): Promise<{ items: TodoItem[]; actions: RecurringAction[] }> {
    const targetDay = today ?? new Date();
    const targetDayStr = formatDate(targetDay);

    const todosData = await store.read<TodoStore>(settings.todosFile, { items: [] });
    const recurringData = await store.read<RecurringStore>(settings.recurringFile, { actions: [] });

    const items = todosData.items ?? [];
    const actions = recurringData.actions ?? [];

    let todosChanged = false;
    let recurringChanged = false;

    for (const action of actions) {
        if (normalizeAction(action)) {
            recurringChanged = true;
        }

        if (!action.active) {
            continue;
        }

        const schedule = action.schedule;
        if (!schedule || typeof schedule !== 'object' || !matchesSchedule(schedule, targetDay)) {
            continue;
        }

        if (action.lastCreatedDate === targetDayStr) {
            continue;
        }

        if (hasExistingItemForDay(items, action, targetDayStr)) {
            action.lastCreatedDate = targetDayStr;
            recurringChanged = true;
            continue;
        }

        items.push({
            note: (action.note ?? '').trim(),
            date: targetDayStr,
            done: false,
            tags: normalizedTags(action.tags),
        });
        action.lastCreatedDate = targetDayStr;
        todosChanged = true;
        recurringChanged = true;
    }

    if (recurringChanged) {
        await store.write(settings.recurringFile, recurringData);
    }
    if (todosChanged) {
        await store.write(settings.todosFile, todosData);
    }

    return { items, actions };
}

function normalizeAction(action: RecurringAction): boolean {
    let changed = false;

    if (!Array.isArray(action.tags)) {
        action.tags = [];
        changed = true;
    }
    if (action.active === undefined) {
        action.active = true;
        changed = true;
    }
    if (typeof action.instances !== 'object' || action.instances === null) {
        action.instances = {};
        changed = true;
    }

    const schedule = action.schedule as unknown as Record<string, unknown> | undefined;
    if (schedule && 'timeOfDay' in schedule) {
        delete schedule['timeOfDay'];
        changed = true;
    }

    return changed;
}

function matchesSchedule(schedule: RecurringSchedule, targetDay: Date): boolean {
    const type = schedule.type;

    if (type === 'daily') {
        return true;
    }
    if (type === 'weekly') {
        return normalizedNumbers(schedule.weekdays).includes(targetDay.getDay());
    }
    if (type === 'monthly') {
        const weekdays = normalizedNumbers(schedule.weekdays);
        const weeks = normalizedNumbers(schedule.weeks);
        const weekOfMonth = Math.floor((targetDay.getDate() - 1) / 7) + 1;
        return weekdays.includes(targetDay.getDay()) && weeks.includes(weekOfMonth);
    }
    return false;
}

function normalizedNumbers(raw: unknown): number[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const result: number[] = [];
    for (const value of raw) {
        if (typeof value === 'number') {
            result.push(value);
        } else if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
            result.push(parseInt(value.trim(), 10));
        }
    }
    return result;
}

function normalizedTags(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((tag): tag is string => typeof tag === 'string');
}

function hasExistingItemForDay(items: TodoItem[], action: RecurringAction, day: string): boolean {
    const note = (action.note ?? '').trim();
    const tags = normalizedTags(action.tags);

    return items.some(
        item =>
            item.date === day &&
            (item.note ?? '').trim() === note &&
            JSON.stringify(normalizedTags(item.tags)) === JSON.stringify(tags)
    );
}

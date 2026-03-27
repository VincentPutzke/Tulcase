import { describe, it, expect } from 'vitest';

// ── Unit-testable helpers extracted from record-calendar.html / .view.ts ──────
// Pure functions re-implemented here for testing without VS Code dependencies.

type RecordEntry = { time_spent_min: number; notes: string };
type DaysMap = Record<string, RecordEntry[]>;

/** Sum of minutes for a single day's entries. */
function dayTotalMin(entries: RecordEntry[]): number {
    return entries.reduce((sum, e) => sum + e.time_spent_min, 0);
}

/** Whether a day has at least one entry. */
function dayHasEntries(days: DaysMap, dateStr: string): boolean {
    const entries = days[dateStr];
    return !!entries && entries.length > 0;
}

/** Compute the start offset (0-based) for a Monday-first calendar. */
function computeStartOffset(year: number, month: number): number {
    const firstDow = new Date(year, month - 1, 1).getDay(); // 0 = Sun
    return (firstDow + 6) % 7; // shift to Mon-first
}

/** Compute aggregate stats for a month. */
function computeMonthSummary(days: DaysMap): { totalMin: number; workedDays: number; avgMin: number } {
    let totalMin = 0;
    let workedDays = 0;
    for (const entries of Object.values(days)) {
        const dt = dayTotalMin(entries);
        if (dt > 0) { totalMin += dt; workedDays++; }
    }
    const avgMin = workedDays > 0 ? Math.round(totalMin / workedDays) : 0;
    return { totalMin, workedDays, avgMin };
}

/** Format minutes as H:MM. */
function fmt(min: number): string {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h + ':' + String(m).padStart(2, '0');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('dayTotalMin', () => {
    it('returns 0 for an empty array', () => {
        expect(dayTotalMin([])).toBe(0);
    });

    it('sums multiple entries', () => {
        const entries: RecordEntry[] = [
            { time_spent_min: 60, notes: 'a' },
            { time_spent_min: 90, notes: 'b' },
            { time_spent_min: 30, notes: 'c' },
        ];
        expect(dayTotalMin(entries)).toBe(180);
    });

    it('handles a single entry', () => {
        expect(dayTotalMin([{ time_spent_min: 45, notes: '' }])).toBe(45);
    });
});

describe('dayHasEntries', () => {
    it('returns false for a missing date', () => {
        expect(dayHasEntries({}, '2026-01-15')).toBe(false);
    });

    it('returns false for an empty array on a date', () => {
        expect(dayHasEntries({ '2026-01-15': [] }, '2026-01-15')).toBe(false);
    });

    it('returns true when entries exist', () => {
        expect(dayHasEntries({
            '2026-01-15': [{ time_spent_min: 60, notes: 'x' }],
        }, '2026-01-15')).toBe(true);
    });
});

describe('computeStartOffset', () => {
    it('returns 0 for a month starting on Monday', () => {
        // 2026-06-01 is a Monday
        expect(computeStartOffset(2026, 6)).toBe(0);
    });

    it('returns 6 for a month starting on Sunday', () => {
        // 2026-03-01 is a Sunday
        expect(computeStartOffset(2026, 3)).toBe(6);
    });

    it('returns 3 for a month starting on Thursday', () => {
        // 2026-01-01 is a Thursday
        expect(computeStartOffset(2026, 1)).toBe(3);
    });
});

describe('computeMonthSummary', () => {
    it('returns zeros for empty days', () => {
        expect(computeMonthSummary({})).toEqual({
            totalMin: 0, workedDays: 0, avgMin: 0,
        });
    });

    it('computes totals across multiple days', () => {
        const days: DaysMap = {
            '2026-01-10': [{ time_spent_min: 120, notes: '' }],
            '2026-01-11': [
                { time_spent_min: 60, notes: '' },
                { time_spent_min: 60, notes: '' },
            ],
            '2026-01-12': [{ time_spent_min: 90, notes: '' }],
        };
        const result = computeMonthSummary(days);
        expect(result.totalMin).toBe(330);
        expect(result.workedDays).toBe(3);
        expect(result.avgMin).toBe(110);
    });

    it('ignores days with 0-minute entries', () => {
        const days: DaysMap = {
            '2026-01-10': [{ time_spent_min: 0, notes: '' }],
            '2026-01-11': [{ time_spent_min: 120, notes: '' }],
        };
        const result = computeMonthSummary(days);
        expect(result.workedDays).toBe(1);
        expect(result.totalMin).toBe(120);
    });
});

describe('fmt', () => {
    it('formats 0 minutes', () => {
        expect(fmt(0)).toBe('0:00');
    });

    it('formats 90 minutes as 1:30', () => {
        expect(fmt(90)).toBe('1:30');
    });

    it('formats 480 minutes as 8:00', () => {
        expect(fmt(480)).toBe('8:00');
    });

    it('pads single-digit minutes', () => {
        expect(fmt(65)).toBe('1:05');
    });
});

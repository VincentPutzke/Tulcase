/** Date format used across the application: YYYY-MM-DD */
export const DATE_FMT = 'yyyy-MM-dd';

/**
 * Parse a flexible time string to total minutes.
 *
 * Accepted formats:
 *   90        → 90 minutes
 *   1.5 / 1,5 → 90 minutes
 *   1:30      → 90 minutes
 *   1.5h      → 90 minutes
 *   1:30h     → 90 minutes
 */
export function parseTimeToMinutes(raw: string): number {
    const value = raw.trim().toLowerCase();
    if (!value) {
        throw new Error('Time must not be empty.');
    }

    if (value.endsWith('h')) {
        const inner = value.slice(0, -1).trim();
        if (inner.includes(':')) {
            return parseHHMM(inner);
        }
        return Math.round(parseFloat(inner.replace(',', '.')) * 60);
    }

    if (value.includes(':')) {
        return parseHHMM(value);
    }

    if (value.includes('.') || value.includes(',')) {
        return Math.round(parseFloat(value.replace(',', '.')) * 60);
    }

    return parseInt(value, 10);
}

/**
 * Convert HH:MM string to total minutes.
 */
function parseHHMM(text: string): number {
    const parts = text.split(':');
    if (parts.length !== 2) {
        throw new Error(`Invalid HH:MM time: ${text}`);
    }
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (m < 0 || m > 59) {
        throw new Error(`Invalid minute in HH:MM time: ${text}`);
    }
    return h * 60 + m;
}

/**
 * Format minutes as HH:MM.
 */
export function minutesToHHMM(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Get today's date as YYYY-MM-DD string.
 */
export function todayStr(): string {
    return formatDate(new Date());
}

/**
 * Get tomorrow's date as YYYY-MM-DD string.
 */
export function tomorrowStr(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatDate(d);
}

/**
 * Format a Date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Parse a YYYY-MM-DD string to a Date.
 */
export function parseDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/**
 * Format a date for display: "Mon, Mar 16"
 */
export function formatDisplayDate(dateStr: string): string {
    const date = parseDate(dateStr);
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
}

/**
 * Add N days to a YYYY-MM-DD date string.
 */
export function addDays(dateStr: string, days: number): string {
    const date = parseDate(dateStr);
    date.setDate(date.getDate() + days);
    return formatDate(date);
}

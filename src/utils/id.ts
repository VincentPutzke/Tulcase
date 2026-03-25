/**
 * Generate a unique ID with a prefix.
 * Format: prefix_timestamp_random
 */
export function generateId(prefix: string): string {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${ts}_${rand}`;
}

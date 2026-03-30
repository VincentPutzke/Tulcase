import type { PlaceholderDef } from '../models/command.model';

/** Regex that matches `<$name$>` placeholder tokens. */
const PLACEHOLDER_RE = /<\$([^$]+)\$>/g;

/**
 * Extract unique placeholder names from a command string
 * in the order of their first appearance.
 *
 * ```
 * parsePlaceholders('git checkout <$branch$> && echo <$msg$> <$branch$>')
 * // → ['branch', 'msg']
 * ```
 */
export function parsePlaceholders(command: string): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    let match: RegExpExecArray | null;

    // Reset lastIndex in case RE was used before
    PLACEHOLDER_RE.lastIndex = 0;
    while ((match = PLACEHOLDER_RE.exec(command)) !== null) {
        const name = match[1];
        if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }

    return names;
}

/**
 * Replace every `<$name$>` token in `command` with the corresponding value
 * from `values`.  Tokens whose name is not in `values` are left as-is.
 */
export function applyPlaceholders(
    command: string,
    values: Record<string, string>,
): string {
    return command.replace(PLACEHOLDER_RE, (full, name: string) => {
        return Object.prototype.hasOwnProperty.call(values, name)
            ? values[name]
            : full;
    });
}

/**
 * Remove keys from `placeholders` that no longer appear in `command`.
 * Returns a cleaned copy (or `undefined` if nothing remains).
 */
export function prunePlaceholders(
    command: string,
    placeholders: Record<string, PlaceholderDef> | undefined,
): Record<string, PlaceholderDef> | undefined {
    if (!placeholders) { return undefined; }

    const active = new Set(parsePlaceholders(command));
    const result: Record<string, PlaceholderDef> = {};
    let count = 0;

    for (const [name, def] of Object.entries(placeholders)) {
        if (active.has(name)) {
            result[name] = def;
            count++;
        }
    }

    return count > 0 ? result : undefined;
}

/**
 * Log Rule Engine — applies named regex rules to job log text.
 *
 * Rules are referenced by name in each scope's `logRules` array and applied
 * in order, line-by-line, right after each chunk is fetched.
 *
 * Two modes:
 *   - **remove**: deletes every match of the pattern from each line.
 *     Lines that become empty after removal are dropped entirely.
 *   - **replace**: performs a regex replacement (pattern → replacement string)
 *     using standard JS `String.prototype.replace` semantics ($1, $2, etc.).
 *
 * A curated set of rules ships built in (`BUILTIN_LOG_RULES`) so common log
 * cleanups need zero configuration.  Custom rules with the same name override
 * a built-in rule.
 */

export interface LogRuleDefinition {
    /** Unique name for referencing from scopes. */
    name: string;
    /** The regex pattern (without delimiters). */
    pattern: string;
    /** Regex flags (default: 'g'). */
    flags?: string;
    /** 'remove' deletes matches; 'replace' substitutes with `replacement`. */
    mode: 'remove' | 'replace';
    /** Replacement string (only used when mode is 'replace'). */
    replacement?: string;
    /** Short human description (shown in the scope editor). */
    description?: string;
}

export interface CompiledRule {
    regex: RegExp;
    mode: 'remove' | 'replace';
    replacement: string;
}

/**
 * Pre-shipped log rules.  Available in every scope without any configuration;
 * the scopes view lists them as toggleable presets.
 */
export const BUILTIN_LOG_RULES: ReadonlyArray<LogRuleDefinition> = [
    {
        name: 'strip-timestamps',
        description: 'Remove ISO timestamps (2026-01-01T12:00:00Z / with offset).',
        pattern: '\\d{4}-\\d{2}-\\d{2}[T ][\\d:.]+(?:Z|[+-]\\d{2}:?\\d{2})?\\s?',
        mode: 'remove',
    },
    {
        name: 'strip-section-markers',
        description: 'Remove GitLab section_start / section_end fold markers.',
        pattern: 'section_(?:start|end):\\d+:[\\w.]+\\r?',
        mode: 'remove',
    },
    {
        name: 'strip-runner-noise',
        description: 'Drop gitlab-runner boilerplate (executor, runner version…).',
        pattern: '^(?:Running with gitlab-runner .*|Preparing the ".+" executor\\s*|Using (?:Docker|Kubernetes|Shell) executor.*|on [\\w-]+ [\\w-]+(?:, system ID: .+)?)$',
        mode: 'remove',
    },
    {
        name: 'strip-progress-bars',
        description: 'Drop percent progress lines (npm/pip/docker pulls…).',
        pattern: '^\\s*[\\w .:/-]*\\d{1,3}%[|▕▏\\[\\]#= .\\w/-]*$',
        mode: 'remove',
    },
    {
        name: 'strip-debug-lines',
        description: 'Drop lines starting with DEBUG or TRACE.',
        pattern: '^\\s*(?:\\[?(?:DEBUG|TRACE)\\]?)[:\\s].*$',
        mode: 'remove',
    },
    {
        name: 'redact-secrets',
        description: 'Mask values after password/token/secret/key assignments.',
        pattern: '((?:password|passwd|token|secret|api[_-]?key|access[_-]?key)\\s*[=:]\\s*)\\S+',
        flags: 'gi',
        mode: 'replace',
        replacement: '$1***',
    },
    {
        name: 'shorten-shas',
        description: 'Shorten 40-char commit SHAs to 8 characters.',
        pattern: '\\b([0-9a-f]{8})[0-9a-f]{32}\\b',
        mode: 'replace',
        replacement: '$1',
    },
];

const BUILTIN_NAMES = new Set(BUILTIN_LOG_RULES.map(r => r.name));

/** Whether a rule name belongs to a pre-shipped rule. */
export function isBuiltinRule(name: string): boolean {
    return BUILTIN_NAMES.has(name);
}

/**
 * Merge built-in and custom rule definitions.  A custom rule whose name
 * matches a built-in one replaces it (later entries win in the engine).
 */
export function mergeRuleDefinitions(
    custom: ReadonlyArray<LogRuleDefinition>,
): LogRuleDefinition[] {
    return [...BUILTIN_LOG_RULES, ...custom];
}

/**
 * Coerce an untyped object into a `LogRuleDefinition`.
 * Returns `undefined` when name or pattern are unusable.  The single home
 * for rule coercion — file reads, form saves, and legacy imports all use it.
 */
export function normalizeRule(raw: unknown): LogRuleDefinition | undefined {
    if (!raw || typeof raw !== 'object') { return undefined; }
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name.trim()) { return undefined; }
    if (typeof r.pattern !== 'string' || !r.pattern) { return undefined; }
    const def: LogRuleDefinition = {
        name: r.name,
        pattern: r.pattern,
        mode: r.mode === 'replace' ? 'replace' : 'remove',
    };
    if (typeof r.flags === 'string' && r.flags.trim())             { def.flags = r.flags.trim(); }
    if (typeof r.replacement === 'string')                         { def.replacement = r.replacement; }
    if (typeof r.description === 'string' && r.description.trim()) { def.description = r.description.trim(); }
    return def;
}

/** Validate a rule definition; returns an error message or undefined. */
export function validateRule(rule: Partial<LogRuleDefinition>): string | undefined {
    if (!rule.name || !rule.name.trim()) { return 'Rule name is required.'; }
    if (!/^[\w][\w.-]*$/.test(rule.name.trim())) {
        return 'Rule name may only contain letters, digits, ".", "-" and "_".';
    }
    if (!rule.pattern) { return 'Regex pattern is required.'; }
    if (rule.mode !== 'remove' && rule.mode !== 'replace') {
        return 'Mode must be "remove" or "replace".';
    }
    try {
        new RegExp(rule.pattern, rule.flags ?? 'g');
    } catch (err) {
        return `Invalid regex: ${err instanceof Error ? err.message : String(err)}`;
    }
    return undefined;
}

export class LogRuleEngine {
    private _compiledByName = new Map<string, CompiledRule>();

    /** Rebuild from raw definitions.  Invalid patterns are silently skipped. */
    setDefinitions(defs: ReadonlyArray<LogRuleDefinition>): void {
        this._compiledByName.clear();
        for (const d of defs) {
            if (!d.name || !d.pattern) { continue; }
            try {
                const flags = d.flags ?? 'g';
                const regex = new RegExp(d.pattern, flags);
                this._compiledByName.set(d.name, {
                    regex,
                    mode: d.mode === 'replace' ? 'replace' : 'remove',
                    replacement: d.replacement ?? '',
                });
            } catch {
                // Invalid regex — skip silently.
            }
        }
    }

    /** Resolve an ordered list of rule names into compiled rules. */
    resolve(ruleNames: ReadonlyArray<string>): CompiledRule[] {
        const out: CompiledRule[] = [];
        for (const name of ruleNames) {
            const rule = this._compiledByName.get(name);
            if (rule) { out.push(rule); }
        }
        return out;
    }

    /**
     * Apply a list of compiled rules to raw text, line-by-line.
     *
     * - **remove** rules delete matches; if a line becomes empty it's dropped.
     * - **replace** rules substitute matches with `replacement`.
     */
    static apply(text: string, rules: ReadonlyArray<CompiledRule>): string {
        if (rules.length === 0 || !text) { return text; }

        const lines = text.split('\n');
        const out: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let drop = false;

            for (const rule of rules) {
                // Reset lastIndex for stateful (global) regexes.
                rule.regex.lastIndex = 0;

                if (rule.mode === 'remove') {
                    line = line.replace(rule.regex, '');
                    // Drop line if it's now only whitespace (but keep truly empty
                    // lines that were empty before, e.g. blank separator lines).
                    if (line.trim() === '' && lines[i].trim() !== '') {
                        drop = true;
                        break;
                    }
                } else {
                    line = line.replace(rule.regex, rule.replacement);
                }
            }

            if (!drop) { out.push(line); }
        }

        return out.join('\n');
    }
}

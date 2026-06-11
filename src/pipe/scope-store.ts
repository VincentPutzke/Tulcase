/**
 * Persistent store for pipe scopes + custom log rules.
 *
 * Scopes live in the active Tulcase database (`pipe_db/scopes.json`), so they
 * are covered by database switching, export/import, and Git Sync exactly like
 * todos, commands, links and notes.
 *
 * The file is the source of truth; every read normalises defensively so a
 * hand-edited file (via "Edit as JSON") can never crash the feature.
 */

import { JsonStore } from '../data/json-store';
import { generateId } from '../utils/id';
import { Emitter } from './events';
import { normalizeScope, type PipeScope } from './models';
import {
    isBuiltinRule,
    validateRule,
    type LogRuleDefinition,
} from './log-rules';

export interface PipeScopeFile {
    scopes: PipeScope[];
    logRules: LogRuleDefinition[];
}

const EMPTY: PipeScopeFile = { scopes: [], logRules: [] };

/** Settings surface needed by the store (kept minimal for tests). */
export interface ScopePathProvider {
    pipeScopesFile: string;
}

export class PipeScopeStore {
    private readonly _store = new JsonStore();
    private readonly _onDidChange = new Emitter<void>();
    readonly onDidChange = this._onDidChange.event;

    /** Optional hook so self-writes don't bounce back via the file watcher. */
    markSelfWrite: ((filePath: string) => void) | undefined;

    constructor(private readonly settings: ScopePathProvider) {}

    get filePath(): string {
        return this.settings.pipeScopesFile;
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    async read(): Promise<PipeScopeFile> {
        const raw = await this._store.read<unknown>(this.filePath, EMPTY);
        return normalizeScopeFile(raw);
    }

    async listScopes(): Promise<PipeScope[]> {
        return (await this.read()).scopes;
    }

    async getScope(id: string): Promise<PipeScope | undefined> {
        return (await this.listScopes()).find(s => s.id === id);
    }

    /** Custom (user-defined) rules only — built-ins live in code. */
    async customRules(): Promise<LogRuleDefinition[]> {
        return (await this.read()).logRules;
    }

    // ── Scope mutations ──────────────────────────────────────────────────────

    /** Insert or update a scope (matched by id). Returns the stored scope. */
    async upsertScope(scope: PipeScope): Promise<PipeScope> {
        const data = await this.read();
        const normalized = normalizeScope(scope, scope.id || generateId('scope'));
        if (!normalized) {
            throw new Error('A scope needs at least one project.');
        }
        const idx = data.scopes.findIndex(s => s.id === normalized.id);
        if (idx >= 0) {
            data.scopes[idx] = normalized;
        } else {
            data.scopes.push(normalized);
        }
        await this._write(data);
        return normalized;
    }

    async removeScope(id: string): Promise<boolean> {
        const data = await this.read();
        const before = data.scopes.length;
        data.scopes = data.scopes.filter(s => s.id !== id);
        if (data.scopes.length === before) { return false; }
        await this._write(data);
        return true;
    }

    async duplicateScope(id: string): Promise<PipeScope | undefined> {
        const data = await this.read();
        const idx = data.scopes.findIndex(s => s.id === id);
        if (idx < 0) { return undefined; }
        const src = data.scopes[idx];
        const copy: PipeScope = {
            ...src,
            projects: [...src.projects],
            tags: [...src.tags],
            statusFilter: src.statusFilter ? [...src.statusFilter] : undefined,
            logRules: src.logRules ? [...src.logRules] : undefined,
            id: generateId('scope'),
            label: `${src.label} (copy)`,
            follow: false,
        };
        data.scopes.splice(idx + 1, 0, copy);
        await this._write(data);
        return copy;
    }

    /** Move a scope up or down in the list. */
    async moveScope(id: string, direction: 'up' | 'down'): Promise<boolean> {
        const data = await this.read();
        const idx = data.scopes.findIndex(s => s.id === id);
        const target = direction === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || target < 0 || target >= data.scopes.length) { return false; }
        const [scope] = data.scopes.splice(idx, 1);
        data.scopes.splice(target, 0, scope);
        await this._write(data);
        return true;
    }

    async setEnabled(id: string, enabled: boolean): Promise<void> {
        await this._patchScope(id, s => { s.enabled = enabled; });
    }

    async setFollow(id: string, follow: boolean): Promise<void> {
        await this._patchScope(id, s => { s.follow = follow; });
    }

    async setTags(id: string, tags: string[]): Promise<void> {
        await this._patchScope(id, s => { s.tags = tags; });
    }

    // ── Custom log-rule mutations ────────────────────────────────────────────

    /**
     * Insert or update a custom rule (matched by name).
     * Built-in names are allowed — the custom rule overrides the built-in.
     * Throws on invalid definitions.
     */
    async upsertRule(rule: LogRuleDefinition): Promise<void> {
        const error = validateRule(rule);
        if (error) { throw new Error(error); }
        const data = await this.read();
        const clean: LogRuleDefinition = {
            name: rule.name.trim(),
            pattern: rule.pattern,
            mode: rule.mode,
        };
        if (rule.flags?.trim())       { clean.flags = rule.flags.trim(); }
        if (rule.mode === 'replace')  { clean.replacement = rule.replacement ?? ''; }
        if (rule.description?.trim()) { clean.description = rule.description.trim(); }

        const idx = data.logRules.findIndex(r => r.name === clean.name);
        if (idx >= 0) { data.logRules[idx] = clean; }
        else          { data.logRules.push(clean); }
        await this._write(data);
    }

    /** Remove a custom rule and detach its name from all scopes (unless it
     *  shadows a built-in, in which case scope references stay valid). */
    async removeRule(name: string): Promise<boolean> {
        const data = await this.read();
        const before = data.logRules.length;
        data.logRules = data.logRules.filter(r => r.name !== name);
        if (data.logRules.length === before) { return false; }
        if (!isBuiltinRule(name)) {
            for (const scope of data.scopes) {
                if (scope.logRules) {
                    scope.logRules = scope.logRules.filter(n => n !== name);
                    if (scope.logRules.length === 0) { delete scope.logRules; }
                }
            }
        }
        await this._write(data);
        return true;
    }

    // ── Bulk import (migration from the standalone Tulcase Pipe extension) ───

    /**
     * Import scopes + rules from a parsed legacy `scopes.jsonc` payload.
     * Returns the number of scopes imported.
     */
    async importLegacy(parsed: unknown): Promise<{ scopes: number; rules: number }> {
        const data = await this.read();

        let rawScopes: unknown[] = [];
        let rawRules: unknown[] = [];
        if (Array.isArray(parsed)) {
            rawScopes = parsed;
        } else if (parsed && typeof parsed === 'object') {
            const obj = parsed as Record<string, unknown>;
            if (Array.isArray(obj.scopes))   { rawScopes = obj.scopes; }
            if (Array.isArray(obj.logRules)) { rawRules = obj.logRules; }
        }

        let scopeCount = 0;
        for (const raw of rawScopes) {
            const scope = normalizeScope(raw, generateId('scope'));
            if (!scope) { continue; }
            // Avoid exact duplicates (same label + same project set).
            const exists = data.scopes.some(s =>
                s.label === scope.label &&
                s.projects.slice().sort().join('|') === scope.projects.slice().sort().join('|'),
            );
            if (exists) { continue; }
            scope.id = generateId('scope');
            data.scopes.push(scope);
            scopeCount++;
        }

        let ruleCount = 0;
        for (const raw of rawRules) {
            if (!raw || typeof raw !== 'object') { continue; }
            const r = raw as Record<string, unknown>;
            const candidate: LogRuleDefinition = {
                name: typeof r.name === 'string' ? r.name : '',
                pattern: typeof r.pattern === 'string' ? r.pattern : '',
                mode: r.mode === 'replace' ? 'replace' : 'remove',
            };
            if (typeof r.flags === 'string')       { candidate.flags = r.flags; }
            if (typeof r.replacement === 'string') { candidate.replacement = r.replacement; }
            if (validateRule(candidate)) { continue; }
            if (data.logRules.some(x => x.name === candidate.name)) { continue; }
            data.logRules.push(candidate);
            ruleCount++;
        }

        if (scopeCount > 0 || ruleCount > 0) {
            await this._write(data);
        }
        return { scopes: scopeCount, rules: ruleCount };
    }

    // ── Internals ────────────────────────────────────────────────────────────

    private async _patchScope(id: string, patch: (scope: PipeScope) => void): Promise<void> {
        const data = await this.read();
        const scope = data.scopes.find(s => s.id === id);
        if (!scope) { return; }
        patch(scope);
        await this._write(data);
    }

    private async _write(data: PipeScopeFile): Promise<void> {
        this.markSelfWrite?.(this.filePath);
        await this._store.write(this.filePath, data);
        this._onDidChange.fire();
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

// ── File-level normalisation ────────────────────────────────────────────────

export function normalizeScopeFile(raw: unknown): PipeScopeFile {
    if (!raw || typeof raw !== 'object') { return { scopes: [], logRules: [] }; }
    const obj = raw as Record<string, unknown>;

    const scopes: PipeScope[] = [];
    const seenIds = new Set<string>();
    if (Array.isArray(obj.scopes)) {
        for (const entry of obj.scopes) {
            const scope = normalizeScope(entry, generateId('scope'));
            if (!scope) { continue; }
            // Guarantee id uniqueness even after careless hand-edits.
            if (seenIds.has(scope.id)) { scope.id = generateId('scope'); }
            seenIds.add(scope.id);
            scopes.push(scope);
        }
    }

    const logRules: LogRuleDefinition[] = [];
    const seenNames = new Set<string>();
    if (Array.isArray(obj.logRules)) {
        for (const entry of obj.logRules) {
            if (!entry || typeof entry !== 'object') { continue; }
            const r = entry as Record<string, unknown>;
            if (typeof r.name !== 'string' || !r.name.trim()) { continue; }
            if (typeof r.pattern !== 'string' || !r.pattern) { continue; }
            if (seenNames.has(r.name)) { continue; }
            const def: LogRuleDefinition = {
                name: r.name,
                pattern: r.pattern,
                mode: r.mode === 'replace' ? 'replace' : 'remove',
            };
            if (typeof r.flags === 'string' && r.flags)             { def.flags = r.flags; }
            if (typeof r.replacement === 'string')                  { def.replacement = r.replacement; }
            if (typeof r.description === 'string' && r.description) { def.description = r.description; }
            seenNames.add(def.name);
            logRules.push(def);
        }
    }

    return { scopes, logRules };
}

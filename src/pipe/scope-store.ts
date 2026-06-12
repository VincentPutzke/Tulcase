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
    normalizeRule,
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

    /** Normalized snapshot cache — read() is called on every poll tick and
     *  view refresh; the file only changes via _write() or external edits
     *  (invalidated through `invalidate()` by the file watcher). */
    private _cache: { path: string; data: PipeScopeFile } | undefined;

    constructor(private readonly settings: ScopePathProvider) {}

    get filePath(): string {
        return this.settings.pipeScopesFile;
    }

    /** Drop the cached snapshot (external file change or DB switch). */
    invalidate(): void {
        this._cache = undefined;
    }

    // ── Read ─────────────────────────────────────────────────────────────────

    async read(): Promise<PipeScopeFile> {
        const path = this.filePath;
        if (this._cache && this._cache.path === path) {
            return this._cache.data;
        }
        const raw = await this._store.read<unknown>(path, EMPTY);
        let repaired = false;
        let dropped = false;
        const data = normalizeScopeFile(
            raw,
            () => { repaired = true; },
            () => { dropped = true; },
        );
        this._cache = { path, data };
        if (repaired && !dropped) {
            // Persist generated/fixed scope ids so identity stays stable
            // across reads (hand-written files may omit ids entirely).
            // Skipped when entries were dropped — never rewrite a file the
            // user may be hand-editing into shape.
            await this._write(data);
        }
        return data;
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

    /**
     * Insert or update a scope (matched by id).  Accepts untyped input —
     * this is the single normalization/validation point for scope saves.
     * Returns the stored scope.
     */
    async upsertScope(scope: PipeScope | unknown): Promise<PipeScope> {
        const data = await this.read();
        const rawId = scope && typeof scope === 'object'
            ? (scope as Record<string, unknown>).id
            : undefined;
        const fallbackId = typeof rawId === 'string' && rawId.trim()
            ? rawId
            : generateId('scope');
        const normalized = normalizeScope(scope, fallbackId);
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
        const clean = normalizeRule({ ...rule, name: rule.name?.trim() });
        const error = validateRule(clean ?? rule);
        if (error) { throw new Error(error); }
        if (!clean) { throw new Error('Rule name and pattern are required.'); }
        if (clean.mode === 'replace' && clean.replacement === undefined) {
            clean.replacement = '';
        }

        const data = await this.read();
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
            const candidate = normalizeRule(raw);
            if (!candidate || validateRule(candidate)) { continue; }
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
        const path = this.filePath;
        this.markSelfWrite?.(path);
        await this._store.write(path, data);
        this._cache = { path, data };
        this._onDidChange.fire();
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

// ── File-level normalisation ────────────────────────────────────────────────

/**
 * Coerce a parsed scopes file into a valid `PipeScopeFile`.
 *
 * `onIdRepaired` fires when a scope was missing a usable id (or had a
 * duplicate) and got a generated one — callers may persist the repair so
 * scope identity stays stable across reads.  Repairs are NOT persisted by
 * `read()` when entries were dropped (`onEntryDropped`), so a half-finished
 * hand-edit is never silently rewritten on disk.
 */
export function normalizeScopeFile(
    raw: unknown,
    onIdRepaired?: () => void,
    onEntryDropped?: () => void,
): PipeScopeFile {
    if (!raw || typeof raw !== 'object') { return { scopes: [], logRules: [] }; }
    const obj = raw as Record<string, unknown>;

    const scopes: PipeScope[] = [];
    const seenIds = new Set<string>();
    if (Array.isArray(obj.scopes)) {
        for (const entry of obj.scopes) {
            const rawId = entry && typeof entry === 'object'
                ? (entry as Record<string, unknown>).id
                : undefined;
            const scope = normalizeScope(entry, generateId('scope'));
            if (!scope) {
                onEntryDropped?.();
                continue;
            }
            // Guarantee id uniqueness even after careless hand-edits.
            if (seenIds.has(scope.id)) { scope.id = generateId('scope'); }
            // Missing, invalid, or duplicate id → a fresh one was assigned.
            if (scope.id !== rawId) { onIdRepaired?.(); }
            seenIds.add(scope.id);
            scopes.push(scope);
        }
    }

    const logRules: LogRuleDefinition[] = [];
    const seenNames = new Set<string>();
    if (Array.isArray(obj.logRules)) {
        for (const entry of obj.logRules) {
            const def = normalizeRule(entry);
            if (!def || seenNames.has(def.name)) { continue; }
            seenNames.add(def.name);
            logRules.push(def);
        }
    }

    return { scopes, logRules };
}

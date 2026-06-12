/**
 * Semantic three-way merge for Tulcase data files.
 *
 * Git sees pretty-printed JSON, so two machines touching the same store file
 * (one note added here, one added there) conflict constantly even though the
 * *data* merges trivially.  This module merges at the data level instead:
 * id-keyed collections are reconciled item by item, so the only situation
 * left for a human is "the same item was edited on both sides" — and even
 * that auto-resolves when the item carries an `updatedAt` timestamp
 * (newer edit wins) or deterministically (local wins) otherwise.
 *
 * Per-key three-way rules:
 *   - added on one side                     → kept
 *   - removed on one side, untouched on the other → removed
 *   - removed on one side, edited on the other    → kept (edit beats delete)
 *   - edited on one side                    → edited version
 *   - edited on both sides identically      → kept
 *   - edited on both sides differently      → newer `updatedAt` wins,
 *                                             otherwise local wins
 *
 * Pure module (no vscode imports) — fully unit-testable.
 */

// ── Public API ──────────────────────────────────────────────────────────────

export interface MergeOutcome {
    /** Pretty-printed merged file content (JsonStore format). */
    text: string;
    /** Number of same-item double edits that were auto-resolved. */
    softConflicts: number;
}

/**
 * Merge a conflicted Tulcase store file.
 *
 * @param relPath  path of the file relative to the repo root (any separators)
 * @param base     content of the common ancestor (undefined for add/add)
 * @param ours     local content
 * @param theirs   remote content
 * @returns merged content, or `undefined` when this file type cannot be
 *          merged semantically (caller falls back to manual resolution)
 */
export function mergeStoreFile(
    relPath: string,
    base: string | undefined,
    ours: string,
    theirs: string,
): MergeOutcome | undefined {
    const path = relPath.replace(/\\/g, '/');
    const merger = pickMerger(path);
    if (!merger) { return undefined; }

    const baseVal = parseJson(base ?? '');
    const oursVal = parseJson(ours);
    const theirsVal = parseJson(theirs);
    if (oursVal === INVALID || theirsVal === INVALID) { return undefined; }

    const counter = { softConflicts: 0 };
    try {
        const merged = merger(
            baseVal === INVALID ? undefined : baseVal,
            oursVal,
            theirsVal,
            counter,
        );
        if (merged === undefined) { return undefined; }
        return {
            text: JSON.stringify(merged, null, 2),
            softConflicts: counter.softConflicts,
        };
    } catch {
        return undefined;
    }
}

/** Whether a repo-relative path is a store this module knows how to merge. */
export function isMergeableStore(relPath: string): boolean {
    return pickMerger(relPath.replace(/\\/g, '/')) !== undefined;
}

// ── File-type dispatch ──────────────────────────────────────────────────────

interface SoftConflictCounter { softConflicts: number; }

type Merger = (
    base: unknown,
    ours: unknown,
    theirs: unknown,
    counter: SoftConflictCounter,
) => unknown;

function pickMerger(path: string): Merger | undefined {
    if (path.endsWith('/todo_db/todos.json')) {
        return makeStoreMerger({ items: byIdOrValue });
    }
    if (path.endsWith('/todo_db/recurring.json')) {
        return mergeRecurringRoot;
    }
    if (path.endsWith('/commands_db/commands.json')) {
        return makeStoreMerger({ items: byIdOrValue, folders: byIdOrValue });
    }
    if (path.endsWith('/lists_db/lists.json')) {
        return makeStoreMerger({ notes: byIdOrValue, folders: byIdOrValue, lists: byIdOrValue });
    }
    if (path.endsWith('/links_db/links.json')) {
        return makeStoreMerger({ root: linkTreeMerge });
    }
    if (path.endsWith('/tags_db/tags.json')) {
        return makeStoreMerger({ tags: recordMerge });
    }
    if (path.endsWith('/pipe_db/scopes.json')) {
        return makeStoreMerger({ scopes: byIdOrValue, logRules: byNameOrValue });
    }
    if (/\/records_db\/\d{4}\/\d{2}\.json$/.test(path)) {
        return mergeRecordDb;
    }
    return undefined;
}

// ── Generic helpers ─────────────────────────────────────────────────────────

const INVALID = Symbol('invalid-json');

function parseJson(text: string): unknown {
    const trimmed = text.trim();
    if (!trimmed) { return undefined; }
    try {
        return JSON.parse(trimmed);
    } catch {
        return INVALID;
    }
}

function isObject(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Deterministic deep-equality via canonical (key-sorted) serialization. */
function canonical(v: unknown): string {
    if (Array.isArray(v)) {
        return '[' + v.map(canonical).join(',') + ']';
    }
    if (isObject(v)) {
        return '{' + Object.keys(v).sort()
            .map(k => JSON.stringify(k) + ':' + canonical(v[k]))
            .join(',') + '}';
    }
    return JSON.stringify(v) ?? 'null';
}

function deepEqual(a: unknown, b: unknown): boolean {
    return canonical(a) === canonical(b);
}

/** Resolve a same-key double edit: newer `updatedAt` wins, else local wins. */
function resolveDoubleEdit(ours: unknown, theirs: unknown, counter: SoftConflictCounter): unknown {
    counter.softConflicts++;
    if (isObject(ours) && isObject(theirs)) {
        const o = Date.parse(String(ours.updatedAt ?? ''));
        const t = Date.parse(String(theirs.updatedAt ?? ''));
        if (Number.isFinite(o) && Number.isFinite(t) && t > o) {
            return theirs;
        }
    }
    return ours;
}

// ── Keyed-array merge ───────────────────────────────────────────────────────

type KeyFn = (item: unknown) => string;

const keyById: KeyFn = item =>
    isObject(item) && typeof item.id === 'string' && item.id
        ? 'id:' + item.id
        : 'val:' + canonical(item);

const keyByName: KeyFn = item =>
    isObject(item) && typeof item.name === 'string' && item.name
        ? 'name:' + item.name
        : 'val:' + canonical(item);

/**
 * Three-way merge of an array keyed by `keyOf`.
 * Preserves local order; remote-only additions are appended in remote order.
 */
function mergeKeyedArray(
    base: unknown[],
    ours: unknown[],
    theirs: unknown[],
    keyOf: KeyFn,
    counter: SoftConflictCounter,
    mergeMatched?: (b: unknown, o: unknown, t: unknown) => unknown,
): unknown[] {
    const baseMap = toMap(base, keyOf);
    const oursMap = toMap(ours, keyOf);
    const theirsMap = toMap(theirs, keyOf);

    const out: unknown[] = [];
    const emitted = new Set<string>();

    for (const [key, ourItem] of oursMap) {
        emitted.add(key);
        const baseItem = baseMap.get(key);
        const theirItem = theirsMap.get(key);

        if (theirsMap.has(key)) {
            if (deepEqual(ourItem, theirItem)) {
                out.push(ourItem);
            } else if (baseMap.has(key) && deepEqual(ourItem, baseItem)) {
                out.push(theirItem);                       // only remote edited
            } else if (baseMap.has(key) && deepEqual(theirItem, baseItem)) {
                out.push(ourItem);                         // only local edited
            } else if (mergeMatched) {
                out.push(mergeMatched(baseItem, ourItem, theirItem));
            } else {
                out.push(resolveDoubleEdit(ourItem, theirItem, counter));
            }
        } else if (baseMap.has(key)) {
            // Remote deleted it.  Keep only if we edited it since the base.
            if (!deepEqual(ourItem, baseItem)) {
                out.push(ourItem);                         // edit beats delete
            }
        } else {
            out.push(ourItem);                             // local addition
        }
    }

    for (const [key, theirItem] of theirsMap) {
        if (emitted.has(key)) { continue; }
        if (baseMap.has(key)) {
            // We deleted it.  Keep only if remote edited it since the base.
            if (!deepEqual(theirItem, baseMap.get(key))) {
                out.push(theirItem);                       // edit beats delete
            }
        } else {
            out.push(theirItem);                           // remote addition
        }
    }

    return out;
}

function toMap(items: unknown[], keyOf: KeyFn): Map<string, unknown> {
    const map = new Map<string, unknown>();
    for (const item of items) {
        const key = keyOf(item);
        if (!map.has(key)) { map.set(key, item); }
    }
    return map;
}

// ── Field mergers (per store property) ──────────────────────────────────────

type FieldMerger = (
    base: unknown,
    ours: unknown,
    theirs: unknown,
    counter: SoftConflictCounter,
) => unknown;

const byIdOrValue: FieldMerger = (base, ours, theirs, counter) =>
    mergeKeyedArray(asArray(base), asArray(ours), asArray(theirs), keyById, counter);

const byNameOrValue: FieldMerger = (base, ours, theirs, counter) =>
    mergeKeyedArray(asArray(base), asArray(ours), asArray(theirs), keyByName, counter);

/** Merge a `Record<string, value>` (e.g. the tag map) key by key. */
const recordMerge: FieldMerger = (base, ours, theirs, counter) => {
    const b = isObject(base) ? base : {};
    const o = isObject(ours) ? ours : {};
    const t = isObject(theirs) ? theirs : {};
    const out: Record<string, unknown> = {};

    for (const key of new Set([...Object.keys(o), ...Object.keys(t)])) {
        const inOurs = key in o;
        const inTheirs = key in t;
        const inBase = key in b;
        if (inOurs && inTheirs) {
            if (deepEqual(o[key], t[key]))      { out[key] = o[key]; }
            else if (inBase && deepEqual(o[key], b[key])) { out[key] = t[key]; }
            else if (inBase && deepEqual(t[key], b[key])) { out[key] = o[key]; }
            else { out[key] = resolveDoubleEdit(o[key], t[key], counter); }
        } else if (inOurs) {
            if (!inBase || !deepEqual(o[key], b[key])) { out[key] = o[key]; }
        } else if (inTheirs) {
            if (!inBase || !deepEqual(t[key], b[key])) { out[key] = t[key]; }
        }
    }
    return out;
};

/** Recursive merge for the links tree (children merged by node id). */
const linkTreeMerge: FieldMerger = (base, ours, theirs, counter) => {
    const stripChildren = (item: unknown): unknown => {
        if (!isObject(item)) { return item; }
        const copy = { ...item };
        delete copy.children;
        return copy;
    };
    return mergeKeyedArray(
        asArray(base), asArray(ours), asArray(theirs), keyById, counter,
        (b, o, t) => {
            if (!isObject(o) || !isObject(t)) {
                return resolveDoubleEdit(o, t, counter);
            }
            // Merge node attributes and children independently.
            const bObj = isObject(b) ? b : undefined;
            const attrs = deepEqual(stripChildren(o), stripChildren(t))
                ? stripChildren(o)
                : (bObj && deepEqual(stripChildren(o), stripChildren(bObj))) ? stripChildren(t)
                : (bObj && deepEqual(stripChildren(t), stripChildren(bObj))) ? stripChildren(o)
                : stripChildren(resolveDoubleEdit(o, t, counter));
            const children = linkTreeMerge(
                bObj?.children, o.children, t.children, counter,
            ) as unknown[];
            const node = { ...(attrs as Record<string, unknown>) };
            if (children.length > 0 || o.children !== undefined || t.children !== undefined) {
                node.children = children;
            }
            return node;
        },
    );
};

function asArray(v: unknown): unknown[] {
    return Array.isArray(v) ? v : [];
}

// ── Store-shaped mergers ────────────────────────────────────────────────────

/**
 * Build a merger for `{ field: collection, ... }`-shaped stores.
 * Unknown extra fields are carried over from local (or remote when only
 * remote has them).
 */
function makeStoreMerger(fields: Record<string, FieldMerger>): Merger {
    return (base, ours, theirs, counter) => {
        const b = isObject(base) ? base : {};
        const o = isObject(ours) ? ours : {};
        const t = isObject(theirs) ? theirs : {};

        const out: Record<string, unknown> = { ...t, ...o };
        for (const [field, merger] of Object.entries(fields)) {
            if (field in o || field in t || field in b) {
                out[field] = merger(b[field], o[field], t[field], counter);
            }
        }
        return out;
    };
}

/** recurring.json is a bare array of actions at the root. */
const mergeRecurringRoot: Merger = (base, ours, theirs, counter) => {
    if (!Array.isArray(ours) || !Array.isArray(theirs)) { return undefined; }
    return mergeKeyedArray(asArray(base), ours, theirs, keyById, counter);
};

/** records_db/YYYY/MM.json — merge the per-day entry arrays by value union. */
const mergeRecordDb: Merger = (base, ours, theirs, counter) => {
    if (!isObject(ours) || !isObject(theirs)) { return undefined; }
    const b = isObject(base) ? base : {};
    const bDays = isObject(b.days) ? b.days : {};
    const oDays = isObject(ours.days) ? ours.days : {};
    const tDays = isObject(theirs.days) ? theirs.days : {};

    const days: Record<string, unknown> = {};
    for (const day of new Set([...Object.keys(oDays), ...Object.keys(tDays)])) {
        days[day] = mergeKeyedArray(
            asArray(bDays[day]), asArray(oDays[day]), asArray(tDays[day]),
            item => 'val:' + canonical(item),
            counter,
        );
        if ((days[day] as unknown[]).length === 0) { delete days[day]; }
    }
    return { ...theirs, ...ours, days };
};

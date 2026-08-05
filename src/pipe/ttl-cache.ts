/**
 * Minimal async TTL cache: dedupes concurrent loads for the same key and
 * serves a value until it expires. Used to cache group→projects enumeration
 * (shared between Pipe polling and the Registry) so a group tree isn't
 * re-walked on every poll tick (ticket 07).
 *
 * `now()` is injected so it is deterministic under test.
 */
export class TtlCache<T> {
    private readonly _entries = new Map<string, { value: T; expires: number }>();
    private readonly _inflight = new Map<string, Promise<T>>();

    constructor(
        private readonly ttlMs: number,
        private readonly now: () => number = () => Date.now(),
    ) {}

    /** Return the cached value for `key`, loading (once) if missing/expired. */
    async get(key: string, load: () => Promise<T>): Promise<T> {
        const hit = this._entries.get(key);
        if (hit && hit.expires > this.now()) { return hit.value; }

        const pending = this._inflight.get(key);
        if (pending) { return pending; }

        const promise = load().then(
            value => {
                this._entries.set(key, { value, expires: this.now() + this.ttlMs });
                this._inflight.delete(key);
                return value;
            },
            err => {
                this._inflight.delete(key);
                throw err;
            },
        );
        this._inflight.set(key, promise);
        return promise;
    }

    /** Drop a key (or the whole cache) — e.g. a manual refresh. */
    invalidate(key?: string): void {
        if (key === undefined) { this._entries.clear(); }
        else { this._entries.delete(key); }
    }
}

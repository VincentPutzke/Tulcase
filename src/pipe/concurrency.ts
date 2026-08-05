/**
 * Bounded-concurrency helpers.  Thin wrapper around `Promise.allSettled` that
 * never lets more than `limit` tasks be in flight at once.
 */

/**
 * A resizable counting semaphore used as a single process-wide ceiling on
 * in-flight GitLab requests. Unlike {@link pAllSettledLimit} (which caps one
 * call site), a shared `Semaphore` bounds the TOTAL across nested fan-out, so
 * "max N requests" actually means N regardless of how many pollers/loops are
 * running (see ADR-0001 perf note / ticket 04).
 */
export class Semaphore {
    private _limit: number;
    private _active = 0;
    private readonly _queue: Array<() => void> = [];

    constructor(limit: number) {
        this._limit = Math.max(1, Math.floor(limit));
    }

    /** Adjust the ceiling at runtime (e.g. when the setting changes). */
    setLimit(limit: number): void {
        this._limit = Math.max(1, Math.floor(limit));
        this._drain();
    }

    /** Number of permits currently held (used by tests to assert the ceiling). */
    get active(): number { return this._active; }

    /** Run `fn` once a permit is free, releasing the permit when it settles. */
    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this._acquire();
        try {
            return await fn();
        } finally {
            this._active--;
            this._drain();
        }
    }

    private _acquire(): Promise<void> {
        if (this._active < this._limit) {
            this._active++;
            return Promise.resolve();
        }
        return new Promise<void>(resolve => {
            this._queue.push(() => { this._active++; resolve(); });
        });
    }

    private _drain(): void {
        while (this._active < this._limit && this._queue.length > 0) {
            const next = this._queue.shift()!;
            next();
        }
    }
}

export async function pAllSettledLimit<T, R>(
    items: ReadonlyArray<T>,
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
    const cap = Math.max(1, Math.min(limit, items.length));
    const out: PromiseSettledResult<R>[] = new Array(items.length);
    let cursor = 0;

    async function run(): Promise<void> {
        while (cursor < items.length) {
            const i = cursor++;
            try {
                out[i] = { status: 'fulfilled', value: await worker(items[i], i) };
            } catch (err) {
                out[i] = { status: 'rejected', reason: err };
            }
        }
    }

    const runners = Array.from({ length: cap }, () => run());
    await Promise.all(runners);
    return out;
}

/**
 * Bounded-concurrency helpers.  Thin wrapper around `Promise.allSettled` that
 * never lets more than `limit` tasks be in flight at once.
 */

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

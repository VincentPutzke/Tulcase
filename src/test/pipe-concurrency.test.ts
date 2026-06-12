import { describe, it, expect } from 'vitest';
import { pAllSettledLimit } from '../pipe/concurrency';

describe('pAllSettledLimit', () => {
    it('preserves index order', async () => {
        const items = [10, 5, 1, 3, 8];
        const out = await pAllSettledLimit(items, 2, async (x) => {
            await new Promise(r => setTimeout(r, x));
            return x * 2;
        });
        expect(out.map(r => r.status === 'fulfilled' ? r.value : null))
            .toEqual([20, 10, 2, 6, 16]);
    });

    it('caps in-flight count', async () => {
        let active = 0;
        let max = 0;
        const items = Array.from({ length: 12 }, (_, i) => i);
        await pAllSettledLimit(items, 3, async () => {
            active++; max = Math.max(max, active);
            await new Promise(r => setTimeout(r, 5));
            active--;
        });
        expect(max).toBeLessThanOrEqual(3);
    });

    it('captures rejections', async () => {
        const out = await pAllSettledLimit([1, 2, 3], 2, async (x) => {
            if (x === 2) { throw new Error('boom'); }
            return x;
        });
        expect(out[1].status).toBe('rejected');
        expect(out[0].status).toBe('fulfilled');
        expect(out[2].status).toBe('fulfilled');
    });
});

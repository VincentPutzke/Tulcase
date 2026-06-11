/**
 * Base poller — provides:
 *   - `setActive(bool)` to start/stop the cycle (e.g. on view visibility),
 *   - in-flight guard so overlapping ticks are coalesced,
 *   - `AbortController` cancellation on dispose,
 *   - `tickNow()` to force a refresh.
 *
 * Subclasses implement `intervalMs()` and `tick(signal)`.
 */

import { Emitter } from './events';

export abstract class PollerBase {
    private _timer: NodeJS.Timeout | undefined;
    private _abort: AbortController | undefined;
    private _active = false;
    private _inFlight = false;
    private _disposed = false;

    private readonly _onError = new Emitter<Error>();
    readonly onError = this._onError.event;

    private readonly _onTickStart = new Emitter<void>();
    readonly onTickStart = this._onTickStart.event;

    protected get isActive(): boolean {
        return this._active;
    }

    setActive(active: boolean): void {
        if (this._disposed) { return; }
        if (this._active === active) { return; }
        this._active = active;
        if (active) {
            void this.tickNow();
            this._schedule();
        } else {
            this._clearTimer();
            this._abort?.abort();
            this._abort = undefined;
        }
    }

    async tickNow(): Promise<void> {
        if (this._disposed) { return; }
        if (this._inFlight) { return; }
        this._inFlight = true;
        this._abort?.abort();
        this._abort = new AbortController();
        this._onTickStart.fire();
        try {
            await this.tick(this._abort.signal);
        } catch (err) {
            if (!isAbort(err)) {
                this._onError.fire(err instanceof Error ? err : new Error(String(err)));
            }
        } finally {
            this._inFlight = false;
        }
    }

    /** Number of milliseconds between ticks.  Re-read each schedule. */
    protected abstract intervalMs(): number;

    /** Subclass implementation of one tick.  Receives an abort signal. */
    protected abstract tick(signal: AbortSignal): Promise<void>;

    /** Surface a non-fatal error during a tick (e.g. one failed project). */
    protected raiseError(err: unknown): void {
        if (isAbort(err)) { return; }
        this._onError.fire(err instanceof Error ? err : new Error(String(err)));
    }

    private _schedule(): void {
        if (!this._active || this._disposed) { return; }
        this._clearTimer();
        this._timer = setTimeout(async () => {
            await this.tickNow();
            this._schedule();
        }, this.intervalMs());
    }

    private _clearTimer(): void {
        if (this._timer) { clearTimeout(this._timer); this._timer = undefined; }
    }

    dispose(): void {
        this._disposed = true;
        this._active = false;
        this._clearTimer();
        this._abort?.abort();
        this._abort = undefined;
        this._onError.dispose();
        this._onTickStart.dispose();
    }
}

export function isAbort(err: unknown): boolean {
    return err instanceof Error
        && (err.name === 'AbortError' || /aborted/i.test(err.message));
}

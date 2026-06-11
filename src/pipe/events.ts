/**
 * Minimal typed event emitter mirroring the `vscode.EventEmitter` surface.
 *
 * The pipe domain modules (store, pollers, log sessions) use this instead of
 * `vscode.EventEmitter` so they stay free of the `vscode` module and can be
 * unit-tested without mocks.
 */

export interface Listener<T> {
    (value: T): void;
}

export interface Subscription {
    dispose(): void;
}

export class Emitter<T> {
    private _listeners: Listener<T>[] = [];

    readonly event = (listener: Listener<T>): Subscription => {
        this._listeners.push(listener);
        return {
            dispose: () => {
                this._listeners = this._listeners.filter(l => l !== listener);
            },
        };
    };

    fire(value: T): void {
        for (const listener of [...this._listeners]) {
            listener(value);
        }
    }

    dispose(): void {
        this._listeners = [];
    }
}

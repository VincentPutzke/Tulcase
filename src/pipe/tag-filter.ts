/**
 * Workspace-local scope tag filter for the Pipelines view.
 *
 * The selected tag names are persisted in VS Code's `workspaceState`, so the
 * filter:
 *   - is **per workspace** (each window/folder keeps its own selection),
 *   - **survives restarts**, and
 *   - is **never written to the Tulcase data directory**, so Git Sync never
 *     carries it between machines — the scope list stays shared while each
 *     workspace narrows it independently.
 *
 * An empty selection means "no filter": every scope is active. Otherwise a
 * scope is active when it has at least one selected tag (see
 * {@link scopeMatchesTags}). Scopes that are filtered out are neither shown
 * nor polled.
 */

import * as vscode from 'vscode';
import { Emitter } from './events';
import { scopeMatchesTags } from './scope-filters';
import type { PipeScope } from './models';

const STATE_KEY = 'tulcase.pipe.tagFilter';

export class PipeTagFilter {
    private readonly _onDidChange = new Emitter<void>();
    /** Fires when the selection changes (re-poll + re-render). */
    readonly onDidChange = this._onDidChange.event;

    constructor(private readonly state: vscode.Memento) {}

    /** Currently selected tag names (empty = no filter). */
    get selected(): string[] {
        const raw = this.state.get<unknown>(STATE_KEY, []);
        if (!Array.isArray(raw)) { return []; }
        return raw.filter((t): t is string => typeof t === 'string');
    }

    /** Persist a new selection (deduped, trimmed, sorted) and notify listeners. */
    async setSelected(tags: string[]): Promise<void> {
        const clean = Array.from(
            new Set(tags.filter(t => typeof t === 'string' && t.trim().length > 0)),
        ).sort((a, b) => a.localeCompare(b));
        await this.state.update(STATE_KEY, clean);
        this._onDidChange.fire();
    }

    /** Whether a scope passes the current filter. */
    matches(scope: Pick<PipeScope, 'tags'>): boolean {
        return scopeMatchesTags(scope, this.selected);
    }

    dispose(): void {
        this._onDidChange.dispose();
    }
}

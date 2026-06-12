/**
 * LogLens — orchestrates how job logs open in the editor.
 *
 * Two click modes (decided by the webview from the click's modifier keys):
 *
 *   - **switch** (plain click): the log opens *in place of* the previous
 *     switch-mode log tab — one reusable slot, so browsing many jobs never
 *     floods the editor with tabs.
 *   - **pin** (ctrl/cmd-click): the log opens as an additional tab and is
 *     never auto-closed; the switch slot is left untouched.
 *
 * Plus the live-log plumbing:
 *   - documents are read-only-in-session,
 *   - ANSI colors render as editor decorations and are re-applied whenever
 *     the document updates or the editor becomes visible again,
 *   - the view auto-follows the tail while the user stays at the bottom,
 *   - closing the last tab of a log disposes its polling session + buffers.
 */

import * as vscode from 'vscode';
import { LogDocumentProvider } from './log-document';
import {
    AnsiDecorationManager,
    parseAnsi,
    type AnsiParseState,
    type SpanInfo,
} from './ansi';
import type { LogPoller } from './log-poller';
import type { Job } from './models';
import type { Subscription } from './events';

export class LogLens implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    /** The single reusable "switch" slot (plain-click opens). */
    private _switchUri: string | undefined;

    /** Logs the user pinned via ctrl/cmd-click — never auto-closed. */
    private readonly _pinned = new Set<string>();

    /** Per-document state, keyed by uri.toString().  `clean`/`parse` carry
     *  the incrementally parsed buffer so chunks don't re-parse the whole log. */
    private readonly _docs = new Map<string, {
        jobId: number;
        spans: SpanInfo[];
        clean: string;
        parse: AnsiParseState;
        lineCount: number;
        chunkSub: Subscription;
    }>();

    constructor(
        private readonly logDoc: LogDocumentProvider,
        private readonly logPoller: LogPoller,
        private readonly ansi: AnsiDecorationManager,
    ) {
        this._disposables.push(
            // Re-apply decorations + follow tail when the buffer updates.
            vscode.workspace.onDidChangeTextDocument(e => this._onDocChanged(e.document)),
            // Re-apply decorations when a log editor becomes visible again
            // (VS Code creates a fresh TextEditor without our decorations).
            vscode.window.onDidChangeVisibleTextEditors(editors => {
                for (const editor of editors) {
                    this._applyDecorations(editor);
                }
            }),
            // Release sessions + buffers when the last tab of a log closes.
            vscode.window.tabGroups.onDidChangeTabs(e => this._onTabsClosed(e.closed)),
        );
    }

    /** Open a job's log. `newTab: true` pins it; otherwise reuse the switch slot. */
    async open(job: Job, opts: { newTab: boolean }): Promise<void> {
        if (job.isBridge) {
            void vscode.window.showInformationMessage(
                job.downstreamPipelineId
                    ? `"${job.name}" is a trigger job — its downstream jobs are nested below it in the Pipelines view.`
                    : `"${job.name}" is a trigger job. The downstream pipeline hasn't started yet.`,
            );
            return;
        }

        const session = await this.logPoller.open(job);
        const uri = LogDocumentProvider.uriFor(job.projectId, job.id, job.name);
        const key = uri.toString();

        // Seed the document with the current snapshot.
        const initial = parseAnsi(session.snapshot());
        this.logDoc.setLog(uri, initial.clean);

        // Subscribe once per document to live chunks.  Chunks are parsed
        // incrementally — only `replace` chunks re-parse from scratch.
        if (!this._docs.has(key)) {
            const chunkSub = session.onLogChunk(evt => {
                const state = this._docs.get(key);
                if (!state) { return; }
                if (evt.replace) {
                    const full = parseAnsi(session.snapshot());
                    state.spans = full.spans;
                    state.clean = full.clean;
                    state.parse = full.state;
                } else if (evt.text) {
                    const part = parseAnsi(evt.text, state.parse);
                    state.spans.push(...part.spans);
                    state.clean += part.clean;
                    state.parse = part.state;
                } else {
                    return;  // final-flush marker without text
                }
                // Triggers onDidChangeTextDocument → decorations + tail follow.
                this.logDoc.setLog(uri, state.clean);
            });
            this._docs.set(key, {
                jobId: job.id,
                spans: initial.spans,
                clean: initial.clean,
                parse: initial.state,
                lineCount: 0,
                chunkSub,
            });
        } else {
            const state = this._docs.get(key)!;
            state.spans = initial.spans;
            state.clean = initial.clean;
            state.parse = initial.state;
        }

        // Pinning: ctrl/cmd-click marks the log as pinned; pinned logs are
        // never used as (or closed by) the switch slot.
        if (opts.newTab) {
            this._pinned.add(key);
            if (this._switchUri === key) { this._switchUri = undefined; }
        }
        const isPinned = this._pinned.has(key);

        // Preferred switch mechanism: a VS Code *preview tab*.  Opening the
        // next log as preview replaces the previous one in place — same tab
        // slot, title updates, no flash of two open files.  Falls back to
        // manual slot management when the user disabled preview tabs.
        const previewEnabled = vscode.workspace
            .getConfiguration('workbench.editor')
            .get<boolean>('enablePreview', true);
        const usePreview = !opts.newTab && !isPinned && previewEnabled;

        const previousSwitch = this._switchUri;
        const reuseSlot = !usePreview && !opts.newTab && !isPinned
            && previousSwitch !== undefined && previousSwitch !== key;

        // Open in the column of the previous switch tab so the "slot" stays put.
        const slotColumn = reuseSlot ? findTab(previousSwitch!)?.group.viewColumn : undefined;

        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, {
            preview: usePreview,
            viewColumn: slotColumn ?? vscode.ViewColumn.Active,
        });

        // Read-only in session: logs are for reading, never editing.
        await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadonlyInSession');

        this._applyDecorations(editor);
        this._revealTail(editor);

        if (!usePreview && !opts.newTab && !isPinned) {
            this._switchUri = key;
            // Context switch (manual fallback): close the previous slot tab.
            if (reuseSlot) {
                const prev = findTab(previousSwitch!);
                if (prev) {
                    await vscode.window.tabGroups.close(prev.tab);
                }
            }
        }
    }

    /** Whether any open tab still shows the given log document. */
    private _isOpenInSomeTab(uriString: string): boolean {
        return findTab(uriString) !== undefined;
    }

    private _onTabsClosed(closed: readonly vscode.Tab[]): void {
        for (const tab of closed) {
            if (!(tab.input instanceof vscode.TabInputText)) { continue; }
            const uri = tab.input.uri;
            if (uri.scheme !== LogDocumentProvider.scheme) { continue; }
            const key = uri.toString();
            if (this._isOpenInSomeTab(key)) { continue; }  // still visible elsewhere

            const state = this._docs.get(key);
            if (state) {
                state.chunkSub.dispose();
                this.logPoller.closeJob(state.jobId);
                this._docs.delete(key);
            }
            this.logDoc.forget(uri);
            this._pinned.delete(key);
            if (this._switchUri === key) {
                this._switchUri = undefined;
            }
        }
    }

    private _onDocChanged(doc: vscode.TextDocument): void {
        if (doc.uri.scheme !== LogDocumentProvider.scheme) { return; }
        const key = doc.uri.toString();
        const state = this._docs.get(key);
        if (!state) { return; }

        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.toString() !== key) { continue; }
            this.ansi.apply(editor, state.spans);

            // Auto-follow the tail while the user was already at the bottom.
            const lastVisible = editor.visibleRanges.length > 0
                ? editor.visibleRanges[editor.visibleRanges.length - 1].end.line
                : 0;
            if (lastVisible >= state.lineCount - 3) {
                this._revealTail(editor);
            }
        }
        state.lineCount = doc.lineCount;
    }

    private _applyDecorations(editor: vscode.TextEditor): void {
        if (editor.document.uri.scheme !== LogDocumentProvider.scheme) { return; }
        const state = this._docs.get(editor.document.uri.toString());
        if (state) {
            this.ansi.apply(editor, state.spans);
        }
    }

    private _revealTail(editor: vscode.TextEditor): void {
        const lastLine = Math.max(0, editor.document.lineCount - 1);
        editor.revealRange(
            new vscode.Range(lastLine, 0, lastLine, 0),
            vscode.TextEditorRevealType.Default,
        );
    }

    dispose(): void {
        for (const state of this._docs.values()) {
            state.chunkSub.dispose();
        }
        this._docs.clear();
        for (const d of this._disposables) { d.dispose(); }
    }
}

// ── Tab lookup ──────────────────────────────────────────────────────────────

function findTab(uriString: string): { tab: vscode.Tab; group: vscode.TabGroup } | undefined {
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            if (tab.input instanceof vscode.TabInputText
                && tab.input.uri.toString() === uriString) {
                return { tab, group };
            }
        }
    }
    return undefined;
}

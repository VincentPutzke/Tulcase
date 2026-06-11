/**
 * `TextDocumentContentProvider` for the `tulcase-pipe-log:` URI scheme.  The
 * editor opens these read-only documents to display live job traces.
 */

import * as vscode from 'vscode';

export class LogDocumentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    public static readonly scheme = 'tulcase-pipe-log';

    private readonly _buffers = new Map<string, string>();

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    static uriFor(projectId: number | string, jobId: number, jobName: string): vscode.Uri {
        const safe = jobName.replace(/[^a-zA-Z0-9._-]+/g, '_');
        return vscode.Uri.parse(
            `${LogDocumentProvider.scheme}:/${encodeURIComponent(String(projectId))}/${jobId}/${safe}.log`,
        );
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this._buffers.get(uri.toString()) ?? '';
    }

    setLog(uri: vscode.Uri, content: string): void {
        this._buffers.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    forget(uri: vscode.Uri): void { this._buffers.delete(uri.toString()); }

    dispose(): void {
        this._onDidChange.dispose();
        this._buffers.clear();
    }
}

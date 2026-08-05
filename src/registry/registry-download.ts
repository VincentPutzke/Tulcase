/**
 * Orchestration for downloading a package version's files into a folder.
 *
 * All side effects (folder picker, filesystem, network streaming) are injected,
 * so the conflict/cancel/apply-to-all logic is pure and unit-testable (ticket
 * 10 seam). The adapter in the feature layer supplies `exists`/`saveFile`
 * (streaming the client response to disk) and `resolveConflict` (a VS Code
 * quick pick).
 */

export interface DownloadFile {
    fileName: string;
    size?: number;
}

export type ConflictChoice =
    | 'overwrite' | 'skip' | 'cancel' | 'overwrite-all' | 'skip-all';

export interface DownloadDeps {
    /** Files of the version, already deduped by name. */
    files: readonly DownloadFile[];
    /** Whether the target file already exists in the chosen folder. */
    exists(fileName: string): Promise<boolean>;
    /** Stream the file from GitLab into the chosen folder (overwriting). */
    saveFile(fileName: string): Promise<void>;
    /** Ask the user how to resolve a name clash. */
    resolveConflict(fileName: string): Promise<ConflictChoice>;
    /** True if the user cancelled the whole operation. */
    isCancelled?(): boolean;
    /** Progress ping per file about to be written. */
    onProgress?(fileName: string, index: number, total: number): void;
}

export interface DownloadResult {
    written: string[];
    skipped: string[];
    cancelled: boolean;
}

/**
 * Download every file of a version, resolving name clashes. Returns which
 * files were written vs skipped, and whether the user cancelled partway.
 */
export async function downloadVersion(deps: DownloadDeps): Promise<DownloadResult> {
    const written: string[] = [];
    const skipped: string[] = [];
    let overwriteAll = false;
    let skipAll = false;
    const total = deps.files.length;

    for (let i = 0; i < total; i++) {
        const { fileName } = deps.files[i];
        if (deps.isCancelled?.()) { return { written, skipped, cancelled: true }; }

        if (await deps.exists(fileName)) {
            let choice: ConflictChoice;
            if (overwriteAll) {
                choice = 'overwrite';
            } else if (skipAll) {
                choice = 'skip';
            } else {
                choice = await deps.resolveConflict(fileName);
                if (choice === 'overwrite-all') { overwriteAll = true; choice = 'overwrite'; }
                else if (choice === 'skip-all')  { skipAll = true;      choice = 'skip'; }
                else if (choice === 'cancel')    { return { written, skipped, cancelled: true }; }
            }
            if (choice === 'skip') { skipped.push(fileName); continue; }
        }

        deps.onProgress?.(fileName, i, total);
        await deps.saveFile(fileName);
        written.push(fileName);
    }

    return { written, skipped, cancelled: false };
}

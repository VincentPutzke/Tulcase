/**
 * DocumentFormattingEditProvider for `aplist:` note documents.
 *
 * Applies lightweight markdown formatting rules:
 * - Ensure blank line before headlines (# / ## / ### etc.)
 * - Normalise bullet style to `-` for consistency
 * - Trim trailing whitespace per line
 * - Ensure file ends with a single newline
 */

import * as vscode from 'vscode';
import { NoteFileSystemProvider } from './note-fs';

export class NoteFormattingProvider implements vscode.DocumentFormattingEditProvider {
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
    ): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];
        const lineCount = document.lineCount;

        for (let i = 0; i < lineCount; i++) {
            const line = document.lineAt(i);
            let text = line.text;
            let changed = false;

            // 1. Trim trailing whitespace
            const trimmed = text.replace(/\s+$/, '');
            if (trimmed !== text) {
                text = trimmed;
                changed = true;
            }

            // 2. Normalise bullet style: `* ` → `- ` at line start (with optional indent)
            const bulletMatch = text.match(/^(\s*)\*(\s)/);
            if (bulletMatch) {
                text = bulletMatch[1] + '-' + bulletMatch[2] + text.slice(bulletMatch[0].length);
                changed = true;
            }

            // 3. Ensure blank line before headlines (except at document start)
            if (i > 0 && /^#{1,6}\s/.test(text)) {
                const prevLine = document.lineAt(i - 1);
                if (prevLine.text.trim() !== '') {
                    // Insert a blank line before the headline
                    edits.push(vscode.TextEdit.insert(
                        new vscode.Position(i, 0),
                        '\n',
                    ));
                }
            }

            if (changed) {
                edits.push(vscode.TextEdit.replace(line.range, text));
            }
        }

        // 4. Ensure file ends with exactly one newline
        if (lineCount > 0) {
            const lastLine = document.lineAt(lineCount - 1);
            if (lastLine.text.trim() !== '') {
                // Add a trailing newline
                edits.push(vscode.TextEdit.insert(
                    new vscode.Position(lineCount, 0),
                    '\n',
                ));
            }
        }

        return edits;
    }
}

/** Selector used to register the formatting provider. */
export const NOTE_DOCUMENT_SELECTOR: vscode.DocumentSelector = {
    scheme: NoteFileSystemProvider.scheme,
};

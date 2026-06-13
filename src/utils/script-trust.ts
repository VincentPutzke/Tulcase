/**
 * Trust-marker detection for scripts (pure, no vscode dependency).
 *
 * A comment line containing `tulcase: no-confirm` (hyphen optional) anywhere in
 * a script's body opts that script out of the run-confirmation prompt. Example
 * first line:  `# tulcase: no-confirm`
 */
const TRUST_MARKER = /^[ \t]*#.*\btulcase:\s*no-?confirm\b/im;

/** Whether a script body opts out of the run-confirmation prompt. */
export function isTrustedScript(content: string): boolean {
    return TRUST_MARKER.test(content);
}

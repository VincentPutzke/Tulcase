/**
 * ANSI-to-editor-decoration engine.
 *
 * Parses ANSI SGR (Select Graphic Rendition) escape sequences and applies
 * VS Code `TextEditorDecorationType` entries to color the log text in place.
 *
 * Supports:  bold, dim, italic, underline, 8 standard + 8 bright foreground/
 * background colours, 256-colour palette, 24-bit true colour (38;2;r;g;b).
 */

import * as vscode from 'vscode';

const ESC = String.fromCharCode(27);

// ── Standard 4-bit palette (SGR 30-37, 90-97) ──────────────────────────────
const FG_COLORS: Record<number, string> = {
    30: '#1e1e1e', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
    34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
    90: '#666666', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
    94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#e5e5e5',
};
const BG_COLORS: Record<number, string> = {
    40: '#1e1e1e', 41: '#cd3131', 42: '#0dbc79', 43: '#e5e510',
    44: '#2472c8', 45: '#bc3fbc', 46: '#11a8cd', 47: '#e5e5e5',
    100: '#666666', 101: '#f14c4c', 102: '#23d18b', 103: '#f5f543',
    104: '#3b8eea', 105: '#d670d6', 106: '#29b8db', 107: '#e5e5e5',
};

// ── 256-colour palette (SGR 38;5;n / 48;5;n) ───────────────────────────────
function palette256(n: number): string | undefined {
    if (n < 0 || n > 255) { return undefined; }
    if (n < 8) { return Object.values(FG_COLORS).slice(0, 8)[n]; }
    if (n < 16) { return Object.values(FG_COLORS).slice(8, 16)[n - 8]; }
    if (n < 232) {
        const idx = n - 16;
        const r = Math.round((Math.floor(idx / 36) % 6) * 51);
        const g = Math.round((Math.floor(idx / 6) % 6) * 51);
        const b = Math.round((idx % 6) * 51);
        return `#${hex(r)}${hex(g)}${hex(b)}`;
    }
    const grey = 8 + (n - 232) * 10;
    return `#${hex(grey)}${hex(grey)}${hex(grey)}`;
}
function hex(v: number): string { return v.toString(16).padStart(2, '0'); }

// ── SGR parser ──────────────────────────────────────────────────────────────

interface Style {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
}

function styleKey(s: Style): string {
    return `${s.fg || ''}|${s.bg || ''}|${s.bold ? 'B' : ''}|${s.dim ? 'D' : ''}|${s.italic ? 'I' : ''}|${s.underline ? 'U' : ''}`;
}

const BEL = String.fromCharCode(7);

/**
 * Matches every ANSI escape sequence:
 *   - CSI sequences (group 1 = params, group 2 = intermediates+final byte;
 *     only the SGR final byte `m` affects styling, the rest are stripped),
 *   - OSC sequences (terminated by BEL or ST),
 *   - other single-character Fe escapes.
 */
const ANSI_SEQ_REGEX = new RegExp(
    `${ESC}\\[([0-9;?]*)([ -/]*[@-~])` +
    `|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)` +
    `|${ESC}[@-Z\\\\^_]`,
    'g',
);

export interface SpanInfo {
    /** 0-based line */
    line: number;
    /** 0-based character start */
    startChar: number;
    /** 0-based character end */
    endChar: number;
    style: Style;
}

/**
 * Carry-over state for incremental parsing: position and active style at the
 * end of the previously parsed text.  Pass the returned `state` back in to
 * parse only the newly appended chunk instead of the whole buffer.
 */
export interface AnsiParseState {
    line: number;
    col: number;
    style: Style;
}

/**
 * Parse text that still contains ANSI sequences and return:
 *   - `clean`: the text with ALL ANSI sequences stripped,
 *   - `spans`: decoration ranges keyed by style (line/col offsets continue
 *     from `prior` when given),
 *   - `state`: carry-over for the next incremental call.
 */
export function parseAnsi(
    raw: string,
    prior?: AnsiParseState,
): { clean: string; spans: SpanInfo[]; state: AnsiParseState } {
    const spans: SpanInfo[] = [];
    let clean = '';
    let line = prior?.line ?? 0;
    let col = prior?.col ?? 0;
    let cursor = 0;
    const current: Style = prior ? { ...prior.style } : {};

    for (const m of raw.matchAll(ANSI_SEQ_REGEX)) {
        // Text before this escape sequence.
        const before = raw.slice(cursor, m.index);
        if (before.length > 0) {
            appendText(before, current);
        }
        // Only SGR sequences change styling; everything else is stripped.
        if (m[2] === 'm') {
            parseSgr(m[1], current);
        }
        cursor = m.index + m[0].length;
    }
    // Trailing text after last escape.
    if (cursor < raw.length) {
        appendText(raw.slice(cursor), current);
    }

    return { clean, spans, state: { line, col, style: { ...current } } };

    function appendText(text: string, style: Style): void {
        const hasStyle = style.fg || style.bg || style.bold || style.dim || style.italic || style.underline;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '\n') {
                clean += '\n';
                line++;
                col = 0;
            } else if (ch === '\r') {
                // CR — skip in output
            } else {
                if (hasStyle) {
                    // Extend or start a span.
                    const last = spans.length > 0 ? spans[spans.length - 1] : undefined;
                    if (last && last.line === line && last.endChar === col
                        && styleKey(last.style) === styleKey(style)) {
                        last.endChar = col + 1;
                    } else {
                        spans.push({ line, startChar: col, endChar: col + 1, style: { ...style } });
                    }
                }
                clean += ch;
                col++;
            }
        }
    }

    function parseSgr(params: string, s: Style): void {
        if (!params || params === '0') {
            // Reset all.
            delete s.fg; delete s.bg;
            delete s.bold; delete s.dim; delete s.italic; delete s.underline;
            return;
        }
        const codes = params.split(';').map(Number);
        for (let i = 0; i < codes.length; i++) {
            const c = codes[i];
            if (c === 0) {
                delete s.fg; delete s.bg;
                delete s.bold; delete s.dim; delete s.italic; delete s.underline;
            } else if (c === 1) { s.bold = true; }
            else if (c === 2) { s.dim = true; }
            else if (c === 3) { s.italic = true; }
            else if (c === 4) { s.underline = true; }
            else if (c === 22) { delete s.bold; delete s.dim; }
            else if (c === 23) { delete s.italic; }
            else if (c === 24) { delete s.underline; }
            else if (c === 39) { delete s.fg; }
            else if (c === 49) { delete s.bg; }
            else if (c >= 30 && c <= 37)  { s.fg = FG_COLORS[c]; }
            else if (c >= 90 && c <= 97)  { s.fg = FG_COLORS[c]; }
            else if (c >= 40 && c <= 47)  { s.bg = BG_COLORS[c]; }
            else if (c >= 100 && c <= 107) { s.bg = BG_COLORS[c]; }
            else if (c === 38 || c === 48) {
                // Extended colour.
                const target = c === 38 ? 'fg' : 'bg';
                if (codes[i + 1] === 5) {
                    const col = palette256(codes[i + 2]);
                    if (col) { (s as Record<string, unknown>)[target] = col; }
                    i += 2;
                } else if (codes[i + 1] === 2) {
                    const r = codes[i + 2], g = codes[i + 3], b = codes[i + 4];
                    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                        (s as Record<string, unknown>)[target] = `#${hex(r)}${hex(g)}${hex(b)}`;
                    }
                    i += 4;
                }
            }
        }
    }
}

// ── Decoration manager ──────────────────────────────────────────────────────

/**
 * Caches `TextEditorDecorationType` instances by style key so we don't
 * create thousands of duplicate types.
 */
export class AnsiDecorationManager implements vscode.Disposable {
    private readonly _types = new Map<string, vscode.TextEditorDecorationType>();

    /** Apply ANSI-derived decorations to the given editor. */
    apply(editor: vscode.TextEditor, spans: SpanInfo[]): void {
        // Group spans by style key.
        const byKey = new Map<string, { type: vscode.TextEditorDecorationType; ranges: vscode.Range[] }>();
        for (const span of spans) {
            const key = styleKey(span.style);
            let entry = byKey.get(key);
            if (!entry) {
                entry = { type: this._getOrCreate(key, span.style), ranges: [] };
                byKey.set(key, entry);
            }
            entry.ranges.push(new vscode.Range(span.line, span.startChar, span.line, span.endChar));
        }
        // Clear styles that no longer occur, then set current ones.
        for (const [key, type] of this._types.entries()) {
            if (!byKey.has(key)) { editor.setDecorations(type, []); }
        }
        for (const { type, ranges } of byKey.values()) {
            editor.setDecorations(type, ranges);
        }
    }

    /** Clear all decorations from an editor. */
    clear(editor: vscode.TextEditor): void {
        for (const type of this._types.values()) {
            editor.setDecorations(type, []);
        }
    }

    private _getOrCreate(key: string, style: Style): vscode.TextEditorDecorationType {
        let type = this._types.get(key);
        if (type) { return type; }
        const opts: vscode.DecorationRenderOptions = {};
        if (style.fg) { opts.color = style.fg; }
        if (style.bg) { opts.backgroundColor = style.bg; }
        if (style.bold) { opts.fontWeight = 'bold'; }
        if (style.dim) { opts.opacity = '0.6'; }
        if (style.italic) { opts.fontStyle = 'italic'; }
        if (style.underline) { opts.textDecoration = 'underline'; }
        type = vscode.window.createTextEditorDecorationType(opts);
        this._types.set(key, type);
        return type;
    }

    dispose(): void {
        for (const type of this._types.values()) { type.dispose(); }
        this._types.clear();
    }
}

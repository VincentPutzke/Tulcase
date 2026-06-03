# Command Placeholders — Feature Plan

## Overview

Allow commands to contain named placeholders (`<$name$>`) with optional default-value
lists. When a user copies or sends a command to the terminal, each placeholder opens a
quick-pick / free-text dialog so the final command can be customised on the fly.

---

## Requirements

### R1 — Placeholder Syntax
- A placeholder is any `<$…$>` token inside the command text.
- The text between `<$` and `$>` is the **placeholder name** (e.g. `<$branch$>`).
- Duplicate placeholder names in one command share the same resolution (replaced
  together once the user picks a value).

### R2 — Default-Value Entry During Add / Edit
- **Add flow** (Label → Command → **Placeholders** → Tags → Folder):
  after the command text is entered, the extension scans for `<$…$>` tokens.
  For each _unique_ placeholder a secondary input box appears:
  > "Default values for `<$branch$>` (comma-separated, leave empty for free text only)"
- The user can enter `main, develop, feature/*` or leave the box empty.
- Values are stored per-command, keyed by placeholder name.

### R3 — Placeholder Resolution on Copy / Send Terminal
- When the user triggers **Copy** or **Send to Terminal** (from the webview _or_ the
  command palette), and the command contains placeholders:
  1. For each unique placeholder (in order of first appearance):
     - If default values exist → show a **QuickPick** with the defaults plus a
       "Custom…" entry that opens an input box.
     - If _no_ default values → show an **InputBox** directly.
  2. All occurrences of `<$name$>` are replaced with the chosen value.
  3. The resolved command is copied / sent.
- If the user cancels any prompt, the entire operation is aborted (no partial
  replacement).

### R4 — Edit Support
- The "Edit → Command" path should re-detect placeholders after edit and allow
  updating default values.
- A new edit field **"Placeholders"** is added to the edit menu (only visible when
  the command contains placeholders).

### R5 — Backward Compatibility
- Existing commands without `<$…$>` tokens are completely unaffected.
- The new `placeholders` field defaults to `{}` / `undefined` — the store migration
  handles older entries seamlessly.

---

## Data Model Changes

```typescript
/** Per-placeholder metadata stored alongside a command. */
export interface PlaceholderDef {
    /** Comma-separated default values parsed into an array. Empty = free text only. */
    defaults: string[];
}

export interface CommandItem {
    id: string;
    label: string;
    command: string;
    tags: string[];
    folder: string;
    /** Optional map of placeholder name → default values. */
    placeholders?: Record<string, PlaceholderDef>;
}
```

### Storage Impact
- `commands.json` gains an optional `placeholders` key per item.
- Existing files without the key continue to work (defaults to `{}`).
- No migration step needed — the key is optional.

---

## Potential Problems & Solutions

| # | Problem | Solution |
|---|---------|----------|
| 1 | **Copy/terminal actions currently pass raw `item.command`** — no resolution step. | Extract a `resolveCommand(item)` helper that prompts for each placeholder and returns the final string (or `undefined` on cancel). Call it in `_copyCommand`, `_runInTerminal`, `copyCommandFromPicker`, and `insertCommandInTerminal`. |
| 2 | **Webview copy/terminal buttons** don't go through placeholder resolution because the webview has no VS Code API for QuickPick. | Keep the current message-passing flow: the webview sends `{ type: 'copy', id }` → the extension host resolves placeholders via VS Code QuickPick, then copies. No webview change needed for resolution. |
| 3 | **User edits the command text and changes placeholders** — stored defaults for removed placeholders become stale. | When saving an edit, prune `placeholders` keys that no longer appear in the command. |
| 4 | **Placeholder name collisions with shell syntax** (e.g. `$HOME`). | The delimiter `<$…$>` is distinctive enough and unlikely to conflict. Document this. |
| 5 | **Multiple occurrences of the same placeholder** should resolve once. | The `parsePlaceholders()` util returns unique names in first-appearance order; all occurrences are replaced with `String.replaceAll`. |
| 6 | **Legacy migration** — old commands have no `placeholders` key. | The field is optional. `resolveCommand` treats `undefined` / `{}` as no-op (returns raw command). |

---

## Implementation Plan

### Step 1 — Model & Placeholder Parser (pure functions)
1. Add `PlaceholderDef` interface and optional `placeholders` field to `CommandItem`.
2. Create `src/utils/placeholder.ts`:
   - `parsePlaceholders(command: string): string[]` — returns unique placeholder
     names in order of first occurrence.
   - `applyPlaceholders(command: string, values: Record<string, string>): string` —
     replaces all `<$name$>` tokens with their values.

### Step 2 — Add-Command Flow Update
1. In `command-list.view.ts → _addCommand()`: after the command input, call
   `parsePlaceholders()`. For each name, show an input box for defaults. Build the
   `placeholders` map and store it alongside the item.

### Step 3 — Placeholder Resolution Helper
1. Create `resolveCommand(item: CommandItem): Promise<string | undefined>` in
   `src/utils/placeholder.ts` (VS Code–dependent helper).
2. For each placeholder: QuickPick (if defaults) or InputBox (if empty).
3. Returns the resolved command, or `undefined` on cancel.

### Step 4 — Wire Resolution into All Execution Paths
1. `command-list.view.ts`:
   - `_copyCommand(id)` — call `resolveCommand`, then copy.
   - `_runInTerminal(id)` — call `resolveCommand`, then send.
2. `command-commands.ts`:
   - `copyCommandFromPicker` — resolve after tree-picker selection.
   - `insertCommandInTerminal` — resolve after tree-picker selection.

### Step 5 — Edit Support
1. Add "Placeholders" option in `_editCommand()` — only shown when
   `parsePlaceholders(item.command).length > 0`.
2. Re-prompt defaults for each placeholder, pre-filled with current values.
3. On command text edit, prune stale placeholder keys.

### Step 6 — Webview Visual Indicator
1. In `command-list.html`, render a small badge/indicator per command item when
   `placeholders` exist (so the user can see at a glance which commands are
   parameterised).

### Step 7 — Tests
1. **Unit tests** (`command-list.test.ts`):
   - `parsePlaceholders`: various patterns, duplicates, empty, no placeholders.
   - `applyPlaceholders`: single, multiple, duplicates, no match.
   - Placeholder defaults pruning logic.
2. Run full suite to verify no regressions.

### Step 8 — Documentation & Release
1. Update `CHANGELOG.md`.
2. Bump version.
3. Package VSIX.

---

## Verification Plan

| Check | How |
|-------|-----|
| Parse placeholder names from command text | Unit tests for `parsePlaceholders` |
| Apply placeholder values to command text | Unit tests for `applyPlaceholders` |
| Add-command flow prompts for defaults | Manual: add a command with `<$branch$>` |
| Copy resolves placeholders with QuickPick | Manual: copy a command with defaults |
| Copy resolves with InputBox when no defaults | Manual: copy a command with empty defaults |
| Terminal send resolves placeholders | Manual: send with `<$env$>` placeholder |
| Cancel aborts without partial replacement | Manual: cancel mid-flow |
| Edit → Placeholders re-prompts correctly | Manual: edit defaults |
| Existing commands unaffected | Unit tests + manual: old commands copy/run unchanged |
| All 131+ existing tests still pass | `npm test` |

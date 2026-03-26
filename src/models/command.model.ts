/** A single command/snippet entry (new array-based format). */
export interface CommandItem {
    id: string;
    label: string;
    command: string;
    tags: string[];
    /** Folder path for tree organisation. Empty string = root level. */
    folder: string;
}

/** Root shape of commands.json (v2 — items array). */
export interface CommandStore {
    items: CommandItem[];
}

// ── Legacy format (v1) ────────────────────────────────────────────────────────

/** Legacy entry stored as Record<string, CommandEntry> */
export interface LegacyCommandEntry {
    command: string;
    tags: string[];
}

/** Legacy root shape used before v0.5. */
export interface LegacyCommandStore {
    commands: Record<string, LegacyCommandEntry | string>;
}

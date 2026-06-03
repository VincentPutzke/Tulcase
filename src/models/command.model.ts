/** Per-placeholder metadata stored alongside a command. */
export interface PlaceholderDef {
    /** Default values the user can pick from. Empty array = free-text only. */
    defaults: string[];
}

/** A single command/snippet entry (new array-based format). */
export interface CommandItem {
    id: string;
    label: string;
    command: string;
    tags: string[];
    /** Folder path for tree organisation. Empty string = root level. */
    folder: string;
    /**
     * Optional map of placeholder name → default-value list.
     * A placeholder appears in the command text as `<$name$>`.
     */
    placeholders?: Record<string, PlaceholderDef>;
}

/** Root shape of commands.json (v2 — items array). */
export interface CommandStore {
    items: CommandItem[];
    /** Named folders with parent-based nesting (v3). */
    folders?: CommandFolder[];
}

/** A folder that can contain commands or other folders. */
export interface CommandFolder {
    id: string;          // e.g. 'cf_abc12345'
    name: string;        // display name
    parent: string;      // parent folder ID, '' = root
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

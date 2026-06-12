import type { PlaceholderDef } from './command.model';

/**
 * A single reusable shell script.
 *
 * Unlike commands (whose text lives inline in `commands.json`), a script's
 * body is stored as a real `.sh` file on disk under `scripts_db/files/<id>.sh`.
 * Only the metadata below lives in `scripts.json`, so the script can be edited
 * as an ordinary file, run directly, and synced as a plain text file.
 */
export interface ScriptItem {
    id: string;          // e.g. 'sc_abc12345'
    label: string;       // display name
    /** Optional one-line summary shown in the tree and pickers. */
    description?: string;
    tags: string[];      // tag names
    /** Folder ID for tree organisation. Empty string = root level. */
    folder: string;
    /**
     * Optional map of placeholder name → default-value list.
     * A placeholder appears in the script body as `<$name$>` and is resolved
     * (and substituted into a temp copy) right before the script is run.
     */
    placeholders?: Record<string, PlaceholderDef>;
    createdAt: string;   // ISO date (YYYY-MM-DD)
    updatedAt: string;   // ISO date (YYYY-MM-DD)
}

/** A folder that can contain scripts or other folders. */
export interface ScriptFolder {
    id: string;          // e.g. 'sf_abc12345'
    name: string;        // display name
    parent: string;      // parent folder ID, '' = root
}

/** Root shape of scripts.json. */
export interface ScriptStore {
    items: ScriptItem[];
    folders: ScriptFolder[];
}

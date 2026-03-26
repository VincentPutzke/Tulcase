/** A single note (replaces the old MiniList) */
export interface NoteItem {
    id: string;          // e.g. 'nt_abc12345'
    label: string;       // display name
    content: string;     // raw text (markdown-style)
    tags: string[];      // tag names
    folder: string;      // folder ID, '' = root
    createdAt: string;   // ISO date
    updatedAt: string;   // ISO date
}

/** A folder that can contain notes or other folders */
export interface NoteFolder {
    id: string;          // e.g. 'nf_abc12345'
    name: string;        // display name
    parent: string;      // parent folder ID, '' = root
}

/** Root shape of lists.json (v2 — note-based) */
export interface NoteStore {
    notes: NoteItem[];
    folders: NoteFolder[];
}

// ── Legacy types (for migration from v1 MiniList format) ─────────────────────

/** @deprecated Old list item — used only for migration */
export interface LegacyListItem {
    id: string;
    text: string;
    done: boolean;
    tags: string[];
    createdAt: string;
}

/** @deprecated Old mini-list — used only for migration */
export interface LegacyMiniList {
    id: string;
    label: string;
    description: string;
    tags: string[];
    createdAt: string;
    items: LegacyListItem[];
}

/** @deprecated Old store root — used only for migration */
export interface LegacyListStore {
    lists: LegacyMiniList[];
}

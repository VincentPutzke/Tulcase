/** Single tag definition */
export interface TagDef {
    color: string;
    category: string;
}

/** Root shape of tags.json */
export interface TagStore {
    tags: Record<string, TagDef>;
}

/** Default tag color */
export const DEFAULT_TAG_COLOR = '#8b8fa3';

/** Default tag category */
export const DEFAULT_TAG_CATEGORY = 'general';

/** A node in the link tree — either a folder or a link */
export interface LinkNode {
    id: string;
    type: 'folder' | 'link';
    label: string;
    url?: string;
    expanded?: boolean;
    createdAt?: string;
    tags?: string[];
    children?: LinkNode[];
}

/** Root shape of links.json */
export interface LinkStore {
    root: LinkNode[];
}

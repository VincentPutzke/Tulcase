/** A single item inside a mini-list */
export interface ListItem {
    id: string;
    text: string;
    done: boolean;
    tags: string[];
    createdAt: string;
}

/** A mini-list with nested items */
export interface MiniList {
    id: string;
    label: string;
    description: string;
    tags: string[];
    createdAt: string;
    items: ListItem[];
}

/** Root shape of lists.json */
export interface ListStore {
    lists: MiniList[];
}

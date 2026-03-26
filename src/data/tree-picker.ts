import * as vscode from 'vscode';

/**
 * A single selectable entry in the tree picker.
 *
 * @template T  The opaque payload type returned on selection.
 */
export interface TreePickerItem<T> {
    /** Primary display label. */
    label: string;
    /**
     * Short secondary text shown to the right of the label in the list.
     * Good for: URL, command snippet, tag list.
     */
    description?: string;
    /**
     * Optional folder/group name.  Items that share a group are collected
     * under a labelled separator line so the folder hierarchy is visible.
     * Omit (or pass `undefined`) for root-level items.
     */
    group?: string;
    /** Opaque value returned when the user confirms this item. */
    data: T;
}

export interface TreePickerOptions<T> {
    /** Title rendered at the top of the QuickPick widget. */
    title: string;
    /** Placeholder hint text in the search input. */
    placeholder: string;
    /** All items to show in the picker. */
    items: TreePickerItem<T>[];
    /**
     * Notification shown when the items array is empty.
     * Defaults to `'No items available.'`.
     */
    emptyMessage?: string;
}

/**
 * Show a searchable QuickPick with items visually grouped by folder / group.
 *
 * Root-level items (no `group`) are listed first, followed by each named
 * group under a `QuickPickItemKind.Separator` header.  Groups are sorted
 * alphabetically.  Within each group items are shown in the order supplied.
 *
 * The underlying `matchOnDescription: true` flag makes VS Code search in
 * both the label and the description field, so the user can search by URL,
 * command text, tags, etc.
 *
 * @returns The `data` value of the confirmed item, or `undefined` on cancel.
 */
export async function showTreePicker<T>(
    options: TreePickerOptions<T>,
): Promise<T | undefined> {
    const { title, placeholder, items, emptyMessage } = options;

    if (items.length === 0) {
        vscode.window.showInformationMessage(
            emptyMessage ?? 'No items available.',
        );
        return undefined;
    }

    // ── Separate root items from grouped items ─────────────────────────────────

    const rootItems = items.filter(i => !i.group);
    const groupMap  = new Map<string, TreePickerItem<T>[]>();

    for (const item of items) {
        if (item.group) {
            const bucket = groupMap.get(item.group) ?? [];
            bucket.push(item);
            groupMap.set(item.group, bucket);
        }
    }

    const sortedGroups = [...groupMap.keys()].sort((a, b) => a.localeCompare(b));

    // ── Build the flat list of QuickPickItems with separators ──────────────────

    // Extend QuickPickItem with an optional data payload.
    type PickItem = vscode.QuickPickItem & { data?: T };
    const qpItems: PickItem[] = [];

    for (const item of rootItems) {
        qpItems.push({
            label:       item.label,
            description: item.description,
            data:        item.data,
        });
    }

    for (const group of sortedGroups) {
        qpItems.push({
            label: group,
            kind:  vscode.QuickPickItemKind.Separator,
        });

        for (const item of groupMap.get(group) ?? []) {
            qpItems.push({
                label:       item.label,
                description: item.description,
                data:        item.data,
            });
        }
    }

    // ── Show the picker ────────────────────────────────────────────────────────

    const picked = await vscode.window.showQuickPick(qpItems, {
        title,
        placeHolder:         placeholder,
        matchOnDescription:  true,
    });

    if (!picked || picked.data === undefined) { return undefined; }
    return picked.data;
}

export interface FlatFolderNode {
    id: string;
    parent: string;
}

export interface FlatItemNode {
    id: string;
    folder: string;
}

function hasFolder<TFolder extends FlatFolderNode>(folders: readonly TFolder[], folderId: string): boolean {
    return folderId === '' || folders.some(folder => folder.id === folderId);
}

export function isFolderDescendant<TFolder extends FlatFolderNode>(
    folders: readonly TFolder[],
    ancestorId: string,
    folderId: string,
): boolean {
    if (!folderId) { return false; }

    let current = folders.find(folder => folder.id === folderId);
    while (current) {
        if (current.parent === ancestorId) {
            return true;
        }
        current = current.parent
            ? folders.find(folder => folder.id === current!.parent)
            : undefined;
    }
    return false;
}

export function moveFlatFolder<TFolder extends FlatFolderNode>(
    folders: TFolder[],
    folderId: string,
    targetParentId: string,
): boolean {
    const folder = folders.find(entry => entry.id === folderId);
    if (!folder) { return false; }
    if (!hasFolder(folders, targetParentId)) { return false; }
    if (folder.id === targetParentId) { return false; }
    if (folder.parent === targetParentId) { return false; }
    if (isFolderDescendant(folders, folderId, targetParentId)) { return false; }

    folder.parent = targetParentId;
    return true;
}

export function moveFlatItem<TItem extends FlatItemNode, TFolder extends FlatFolderNode>(
    items: TItem[],
    folders: readonly TFolder[],
    itemId: string,
    targetFolderId: string,
): boolean {
    const item = items.find(entry => entry.id === itemId);
    if (!item) { return false; }
    if (!hasFolder(folders, targetFolderId)) { return false; }
    if (item.folder === targetFolderId) { return false; }

    item.folder = targetFolderId;
    return true;
}
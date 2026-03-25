import type { ArbeitsplatzSettings } from '../config';
import { JsonStore } from './json-store';
import type { TodoStore } from '../models/todo.model';
import type { RecurringStore } from '../models/recurring.model';
import type { CommandStore } from '../models/command.model';
import type { LinkStore, LinkNode } from '../models/link.model';
import type { ListStore } from '../models/list.model';

const store = new JsonStore();

/**
 * Remove a tag from every entity that references it across all stores.
 */
export async function stripTagFromAll(tagName: string, settings: ArbeitsplatzSettings): Promise<void> {
    await applyToAllStores(runStrip, tagName, undefined, settings);
}

/**
 * Rename a tag across every entity store.
 */
export async function renameTagInAll(oldName: string, newName: string, settings: ArbeitsplatzSettings): Promise<void> {
    await applyToAllStores(runRename, oldName, newName, settings);
}

// --- Internal ---

type TagTransform = (tags: string[], tagName: string, newName?: string) => string[];

function runStrip(tags: string[], tagName: string): string[] {
    return tags.filter(t => t !== tagName);
}

function runRename(tags: string[], tagName: string, newName?: string): string[] {
    return tags.map(t => (t === tagName ? newName! : t));
}

async function applyToAllStores(
    fn: TagTransform,
    tagName: string,
    newName: string | undefined,
    settings: ArbeitsplatzSettings
): Promise<void> {
    // Todos
    const todosData = await store.read<TodoStore>(settings.todosFile, { items: [] });
    if (applyTagToItems(fn, todosData.items, tagName, newName)) {
        await store.write(settings.todosFile, todosData);
    }

    // Recurring actions
    const recurringData = await store.read<RecurringStore>(settings.recurringFile, { actions: [] });
    if (applyTagToItems(fn, recurringData.actions, tagName, newName)) {
        await store.write(settings.recurringFile, recurringData);
    }

    // Commands (dict of label → entry)
    const commandsData = await store.read<CommandStore>(settings.commandsFile, { commands: {} });
    let commandsChanged = false;
    for (const val of Object.values(commandsData.commands)) {
        if (typeof val === 'object' && val !== null && applyTagToSingle(fn, val, tagName, newName)) {
            commandsChanged = true;
        }
    }
    if (commandsChanged) {
        await store.write(settings.commandsFile, commandsData);
    }

    // Links (recursive tree)
    const linksData = await store.read<LinkStore>(settings.linksFile, { root: [] });
    if (applyTagToTree(fn, linksData.root, tagName, newName)) {
        await store.write(settings.linksFile, linksData);
    }

    // Lists (each list has tags, plus nested items with tags)
    const listsData = await store.read<ListStore>(settings.listsFile, { lists: [] });
    let listsChanged = false;
    for (const lst of listsData.lists) {
        if (applyTagToSingle(fn, lst, tagName, newName)) {
            listsChanged = true;
        }
        for (const item of lst.items) {
            if (applyTagToSingle(fn, item, tagName, newName)) {
                listsChanged = true;
            }
        }
    }
    if (listsChanged) {
        await store.write(settings.listsFile, listsData);
    }
}

function applyTagToSingle(fn: TagTransform, obj: { tags?: string[] }, tagName: string, newName?: string): boolean {
    const tags = obj.tags ?? [];
    if (!tags.includes(tagName)) {
        return false;
    }
    obj.tags = fn(tags, tagName, newName);
    return true;
}

function applyTagToItems(fn: TagTransform, items: { tags?: string[] }[], tagName: string, newName?: string): boolean {
    let changed = false;
    for (const item of items) {
        if (applyTagToSingle(fn, item, tagName, newName)) {
            changed = true;
        }
    }
    return changed;
}

function applyTagToTree(fn: TagTransform, nodes: LinkNode[], tagName: string, newName?: string): boolean {
    let changed = false;
    for (const n of nodes) {
        if (n.type === 'link' && applyTagToSingle(fn, n, tagName, newName)) {
            changed = true;
        }
        if (n.type === 'folder' && n.children && applyTagToTree(fn, n.children, tagName, newName)) {
            changed = true;
        }
    }
    return changed;
}

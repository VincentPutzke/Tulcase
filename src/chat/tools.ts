/**
 * Language Model Tools for Tulcase.
 *
 * Registers tools via `vscode.lm.registerTool()` so that AI agents
 * (Copilot Chat, Claude Code, etc.) can read and manage Tulcase data.
 *
 * Exposed: TODOs, Notes, Links, Commands, Tags.
 * NOT exposed: Records, Git Sync.
 */

import * as vscode from 'vscode';
import { JsonStore } from '../data/json-store';
import { generateId } from '../utils/id';
import { stripTagFromAll, renameTagInAll } from '../data/tag-propagation';
import { findNode, removeNode, moveNode } from '../data/link-tree';
import type { TulcaseSettings } from '../config';
import type { TodoItem, TodoStore } from '../models/todo.model';
import type { NoteItem, NoteFolder, NoteStore } from '../models/note.model';
import type { LinkNode, LinkStore } from '../models/link.model';
import type { CommandItem, CommandFolder, CommandStore } from '../models/command.model';
import type { TagDef, TagStore } from '../models/tag.model';

const store = new JsonStore();

// ── Helpers ──────────────────────────────────────────────────────────────────

function text(value: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
}

function json(value: unknown): vscode.LanguageModelToolResult {
    return text(JSON.stringify(value, null, 2));
}

type Refresher = () => void;

// ── TODO Tools ───────────────────────────────────────────────────────────────

interface ListTodosInput { filter?: 'all' | 'done' | 'open' | 'overdue' | 'today'; tag?: string }

class ListTodosTool implements vscode.LanguageModelTool<ListTodosInput> {
    constructor(private settings: TulcaseSettings) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ListTodosInput>) {
        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        let items = data.items;
        const today = new Date().toISOString().slice(0, 10);
        const filter = options.input.filter ?? 'all';

        if (filter === 'done') { items = items.filter(i => i.done); }
        else if (filter === 'open') { items = items.filter(i => !i.done); }
        else if (filter === 'overdue') { items = items.filter(i => !i.done && i.date < today); }
        else if (filter === 'today') { items = items.filter(i => i.date === today); }

        if (options.input.tag) {
            const tag = options.input.tag.toLowerCase();
            items = items.filter(i => i.tags.some(t => t.toLowerCase() === tag));
        }

        return json({ count: items.length, items });
    }
}

interface AddTodoInput { note: string; date?: string; tags?: string[] }

class AddTodoTool implements vscode.LanguageModelTool<AddTodoInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<AddTodoInput>) {
        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const today = new Date().toISOString().slice(0, 10);
        const item: TodoItem = {
            id: generateId('todo'),
            note: options.input.note,
            date: options.input.date ?? today,
            done: false,
            tags: options.input.tags ?? [],
        };
        data.items.push(item);
        await store.write(this.settings.todosFile, data);
        this.refresh();
        return json({ created: item });
    }
}

interface UpdateTodoInput { id: string; done?: boolean; note?: string; date?: string; tags?: string[] }

class UpdateTodoTool implements vscode.LanguageModelTool<UpdateTodoInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<UpdateTodoInput>) {
        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const item = data.items.find(i => i.id === options.input.id);
        if (!item) { throw new Error(`Todo not found: ${options.input.id}. Use tulcase_list_todos to find valid IDs.`); }

        if (options.input.done !== undefined) { item.done = options.input.done; }
        if (options.input.note !== undefined) { item.note = options.input.note; }
        if (options.input.date !== undefined) { item.date = options.input.date; }
        if (options.input.tags !== undefined) { item.tags = options.input.tags; }

        await store.write(this.settings.todosFile, data);
        this.refresh();
        return json({ updated: item });
    }
}

interface DeleteTodoInput { id: string }

class DeleteTodoTool implements vscode.LanguageModelTool<DeleteTodoInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<DeleteTodoInput>) {
        const data = await store.read<TodoStore>(this.settings.todosFile, { items: [] });
        const before = data.items.length;
        data.items = data.items.filter(i => i.id !== options.input.id);
        if (data.items.length === before) {
            throw new Error(`Todo not found: ${options.input.id}. Use tulcase_list_todos to find valid IDs.`);
        }
        await store.write(this.settings.todosFile, data);
        this.refresh();
        return text(`Deleted todo ${options.input.id}.`);
    }
}

// ── NOTE Tools ───────────────────────────────────────────────────────────────

interface ListNotesInput { tag?: string }

class ListNotesTool implements vscode.LanguageModelTool<ListNotesInput> {
    constructor(private settings: TulcaseSettings) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ListNotesInput>) {
        const data = await store.read<NoteStore>(this.settings.listsFile, { notes: [], folders: [] });
        let notes = data.notes;
        if (options.input.tag) {
            const tag = options.input.tag.toLowerCase();
            notes = notes.filter(n => n.tags.some(t => t.toLowerCase() === tag));
        }
        return json({ notes, folders: data.folders });
    }
}

interface ReadNoteInput { id: string }

class ReadNoteTool implements vscode.LanguageModelTool<ReadNoteInput> {
    constructor(private settings: TulcaseSettings) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ReadNoteInput>) {
        const data = await store.read<NoteStore>(this.settings.listsFile, { notes: [], folders: [] });
        const note = data.notes.find(n => n.id === options.input.id);
        if (!note) { throw new Error(`Note not found: ${options.input.id}. Use tulcase_list_notes to find valid IDs.`); }
        return json(note);
    }
}

interface AddNoteInput { label: string; content?: string; tags?: string[]; folder?: string }

class AddNoteTool implements vscode.LanguageModelTool<AddNoteInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<AddNoteInput>) {
        const data = await store.read<NoteStore>(this.settings.listsFile, { notes: [], folders: [] });
        const now = new Date().toISOString().slice(0, 10);
        const note: NoteItem = {
            id: generateId('nt'),
            label: options.input.label,
            content: options.input.content ?? '',
            tags: options.input.tags ?? [],
            folder: options.input.folder ?? '',
            createdAt: now,
            updatedAt: now,
        };
        data.notes.push(note);
        await store.write(this.settings.listsFile, data);
        this.refresh();
        return json({ created: note });
    }
}

interface EditNoteInput { id: string; label?: string; content?: string; tags?: string[]; folder?: string }

class EditNoteTool implements vscode.LanguageModelTool<EditNoteInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<EditNoteInput>) {
        const data = await store.read<NoteStore>(this.settings.listsFile, { notes: [], folders: [] });
        const note = data.notes.find(n => n.id === options.input.id);
        if (!note) { throw new Error(`Note not found: ${options.input.id}. Use tulcase_list_notes to find valid IDs.`); }

        if (options.input.label !== undefined) { note.label = options.input.label; }
        if (options.input.content !== undefined) { note.content = options.input.content; }
        if (options.input.tags !== undefined) { note.tags = options.input.tags; }
        if (options.input.folder !== undefined) { note.folder = options.input.folder; }
        note.updatedAt = new Date().toISOString().slice(0, 10);

        await store.write(this.settings.listsFile, data);
        this.refresh();
        return json({ updated: note });
    }
}

// ── LINK Tools ───────────────────────────────────────────────────────────────

interface ListLinksInput { tag?: string }

class ListLinksTool implements vscode.LanguageModelTool<ListLinksInput> {
    constructor(private settings: TulcaseSettings) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ListLinksInput>) {
        const data = await store.read<LinkStore>(this.settings.linksFile, { root: [] });

        if (options.input.tag) {
            const tag = options.input.tag.toLowerCase();
            const filterTree = (nodes: LinkNode[]): LinkNode[] =>
                nodes.reduce<LinkNode[]>((acc, n) => {
                    if (n.type === 'folder') {
                        const children = filterTree(n.children ?? []);
                        if (children.length) { acc.push({ ...n, children }); }
                    } else if (n.tags?.some(t => t.toLowerCase() === tag)) {
                        acc.push(n);
                    }
                    return acc;
                }, []);
            return json({ root: filterTree(data.root) });
        }

        return json(data);
    }
}

interface AddLinkInput { label: string; url: string; tags?: string[]; parentFolderId?: string }

class AddLinkTool implements vscode.LanguageModelTool<AddLinkInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<AddLinkInput>) {
        const data = await store.read<LinkStore>(this.settings.linksFile, { root: [] });
        const node: LinkNode = {
            id: generateId('lk'),
            type: 'link',
            label: options.input.label,
            url: options.input.url,
            tags: options.input.tags ?? [],
            createdAt: new Date().toISOString().slice(0, 10),
        };

        if (options.input.parentFolderId) {
            const parent = findNode(data.root, options.input.parentFolderId);
            if (!parent || parent.type !== 'folder') {
                throw new Error(`Folder not found: ${options.input.parentFolderId}. Use tulcase_list_links to find valid folder IDs.`);
            }
            (parent.children ??= []).push(node);
        } else {
            data.root.push(node);
        }

        await store.write(this.settings.linksFile, data);
        this.refresh();
        return json({ created: node });
    }
}

interface EditLinkInput { id: string; label?: string; url?: string; tags?: string[] }

class EditLinkTool implements vscode.LanguageModelTool<EditLinkInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<EditLinkInput>) {
        const data = await store.read<LinkStore>(this.settings.linksFile, { root: [] });
        const node = findNode(data.root, options.input.id);
        if (!node) { throw new Error(`Link not found: ${options.input.id}. Use tulcase_list_links to find valid IDs.`); }

        if (options.input.label !== undefined) { node.label = options.input.label; }
        if (options.input.url !== undefined) { node.url = options.input.url; }
        if (options.input.tags !== undefined) { node.tags = options.input.tags; }

        await store.write(this.settings.linksFile, data);
        this.refresh();
        return json({ updated: node });
    }
}

// ── COMMAND Tools ────────────────────────────────────────────────────────────

interface ListCommandsInput { tag?: string }

class ListCommandsTool implements vscode.LanguageModelTool<ListCommandsInput> {
    constructor(private settings: TulcaseSettings) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ListCommandsInput>) {
        const data = await store.read<CommandStore>(this.settings.commandsFile, { items: [], folders: [] });
        let items = data.items;
        if (options.input.tag) {
            const tag = options.input.tag.toLowerCase();
            items = items.filter(c => c.tags.some(t => t.toLowerCase() === tag));
        }
        return json({ commands: items, folders: data.folders ?? [] });
    }
}

interface AddCommandInput { label: string; command: string; tags?: string[]; folder?: string }

class AddCommandTool implements vscode.LanguageModelTool<AddCommandInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<AddCommandInput>) {
        const data = await store.read<CommandStore>(this.settings.commandsFile, { items: [], folders: [] });
        const item: CommandItem = {
            id: generateId('cmd'),
            label: options.input.label,
            command: options.input.command,
            tags: options.input.tags ?? [],
            folder: options.input.folder ?? '',
        };
        data.items.push(item);
        await store.write(this.settings.commandsFile, data);
        this.refresh();
        return json({ created: item });
    }
}

interface EditCommandInput { id: string; label?: string; command?: string; tags?: string[] }

class EditCommandTool implements vscode.LanguageModelTool<EditCommandInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<EditCommandInput>) {
        const data = await store.read<CommandStore>(this.settings.commandsFile, { items: [], folders: [] });
        const item = data.items.find(c => c.id === options.input.id);
        if (!item) { throw new Error(`Command not found: ${options.input.id}. Use tulcase_list_commands to find valid IDs.`); }

        if (options.input.label !== undefined) { item.label = options.input.label; }
        if (options.input.command !== undefined) { item.command = options.input.command; }
        if (options.input.tags !== undefined) { item.tags = options.input.tags; }

        await store.write(this.settings.commandsFile, data);
        this.refresh();
        return json({ updated: item });
    }
}

// ── TAG Tools ────────────────────────────────────────────────────────────────

class ListTagsTool implements vscode.LanguageModelTool<Record<string, never>> {
    constructor(private settings: TulcaseSettings) {}

    async invoke() {
        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        const tags = Object.entries(data.tags).map(([name, def]) => ({
            name, color: def.color, category: def.category,
        }));
        return json({ count: tags.length, tags });
    }
}

interface AddTagInput { name: string; color?: string; category?: string }

class AddTagTool implements vscode.LanguageModelTool<AddTagInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<AddTagInput>) {
        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });
        if (data.tags[options.input.name]) {
            throw new Error(`Tag "${options.input.name}" already exists. Use tulcase_manage_tag to modify it.`);
        }
        const def: TagDef = {
            color: options.input.color ?? '#8b8fa3',
            category: options.input.category ?? 'general',
        };
        data.tags[options.input.name] = def;
        await store.write(this.settings.tagsFile, data);
        this.refresh();
        return json({ created: { name: options.input.name, ...def } });
    }
}

interface ManageTagInput { name: string; action: 'rename' | 'recolor' | 'recategorize' | 'delete'; newValue?: string }

class ManageTagTool implements vscode.LanguageModelTool<ManageTagInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ManageTagInput>) {
        const { name, action, newValue } = options.input;
        const data = await store.read<TagStore>(this.settings.tagsFile, { tags: {} });

        if (!data.tags[name]) {
            throw new Error(`Tag "${name}" not found. Use tulcase_list_tags to see available tags.`);
        }

        switch (action) {
            case 'rename': {
                if (!newValue) { throw new Error('newValue is required for rename.'); }
                data.tags[newValue] = data.tags[name];
                delete data.tags[name];
                await store.write(this.settings.tagsFile, data);
                await renameTagInAll(name, newValue, this.settings);
                this.refresh();
                return text(`Renamed tag "${name}" to "${newValue}" across all items.`);
            }
            case 'recolor': {
                if (!newValue) { throw new Error('newValue (hex color) is required for recolor.'); }
                data.tags[name].color = newValue;
                await store.write(this.settings.tagsFile, data);
                this.refresh();
                return text(`Changed color of tag "${name}" to ${newValue}.`);
            }
            case 'recategorize': {
                if (!newValue) { throw new Error('newValue (category name) is required for recategorize.'); }
                data.tags[name].category = newValue;
                await store.write(this.settings.tagsFile, data);
                this.refresh();
                return text(`Changed category of tag "${name}" to "${newValue}".`);
            }
            case 'delete': {
                delete data.tags[name];
                await store.write(this.settings.tagsFile, data);
                await stripTagFromAll(name, this.settings);
                this.refresh();
                return text(`Deleted tag "${name}" and removed it from all items.`);
            }
        }
    }
}

// ── Registration ─────────────────────────────────────────────────────────────

export function registerChatTools(
    context: vscode.ExtensionContext,
    settings: TulcaseSettings,
    refresh: Refresher,
): void {
    context.subscriptions.push(
        // TODOs
        vscode.lm.registerTool('tulcase_list_todos', new ListTodosTool(settings)),
        vscode.lm.registerTool('tulcase_add_todo', new AddTodoTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_update_todo', new UpdateTodoTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_delete_todo', new DeleteTodoTool(settings, refresh)),
        // Notes
        vscode.lm.registerTool('tulcase_list_notes', new ListNotesTool(settings)),
        vscode.lm.registerTool('tulcase_read_note', new ReadNoteTool(settings)),
        vscode.lm.registerTool('tulcase_add_note', new AddNoteTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_edit_note', new EditNoteTool(settings, refresh)),
        // Links
        vscode.lm.registerTool('tulcase_list_links', new ListLinksTool(settings)),
        vscode.lm.registerTool('tulcase_add_link', new AddLinkTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_edit_link', new EditLinkTool(settings, refresh)),
        // Commands
        vscode.lm.registerTool('tulcase_list_commands', new ListCommandsTool(settings)),
        vscode.lm.registerTool('tulcase_add_command', new AddCommandTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_edit_command', new EditCommandTool(settings, refresh)),
        // Tags
        vscode.lm.registerTool('tulcase_list_tags', new ListTagsTool(settings)),
        vscode.lm.registerTool('tulcase_add_tag', new AddTagTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_manage_tag', new ManageTagTool(settings, refresh)),
    );
}

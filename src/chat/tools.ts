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
import { moveFlatFolder, moveFlatItem } from '../data/flat-folder-tree';
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

// ── Helpers (shared with pipe-tools.ts) ──────────────────────────────────────

export function text(value: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(value)]);
}

export function json(value: unknown): vscode.LanguageModelToolResult {
    return text(JSON.stringify(value, null, 2));
}

type Refresher = () => void;

function requireName(value: string | undefined, label: string): string {
    const trimmed = value?.trim();
    if (!trimmed) {
        throw new Error(`${label} is required.`);
    }
    return trimmed;
}

function requireNoteFolder(data: NoteStore, folderId: string): void {
    if (folderId && !data.folders.some(folder => folder.id === folderId)) {
        throw new Error(`Note folder not found: ${folderId}. Use tulcase_list_notes to find valid folder IDs.`);
    }
}

function requireCommandFolder(data: CommandStore, folderId: string): void {
    const folders = data.folders ?? [];
    if (folderId && !folders.some(folder => folder.id === folderId)) {
        throw new Error(`Command folder not found: ${folderId}. Use tulcase_list_commands to find valid folder IDs.`);
    }
}

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
        const folderId = options.input.folder ?? '';
        requireNoteFolder(data, folderId);
        const now = new Date().toISOString().slice(0, 10);
        const note: NoteItem = {
            id: generateId('nt'),
            label: options.input.label,
            content: options.input.content ?? '',
            tags: options.input.tags ?? [],
            folder: folderId,
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
        if (options.input.folder !== undefined) {
            requireNoteFolder(data, options.input.folder);
            note.folder = options.input.folder;
        }
        note.updatedAt = new Date().toISOString().slice(0, 10);

        await store.write(this.settings.listsFile, data);
        this.refresh();
        return json({ updated: note });
    }
}

interface ManageNoteFolderInput {
    action: 'create' | 'rename' | 'delete';
    id?: string;
    name?: string;
    parentId?: string;
}

class ManageNoteFolderTool implements vscode.LanguageModelTool<ManageNoteFolderInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ManageNoteFolderInput>) {
        const data = await store.read<NoteStore>(this.settings.listsFile, { notes: [], folders: [] });
        const { action, id, name, parentId } = options.input;

        switch (action) {
            case 'create': {
                const folderName = requireName(name, 'Folder name');
                const parent = parentId ?? '';
                requireNoteFolder(data, parent);
                const folder: NoteFolder = {
                    id: generateId('nf'),
                    name: folderName,
                    parent,
                };
                data.folders.push(folder);
                await store.write(this.settings.listsFile, data);
                this.refresh();
                return json({ created: folder });
            }
            case 'rename': {
                if (!id) { throw new Error('Folder id is required for rename.'); }
                const folder = data.folders.find(entry => entry.id === id);
                if (!folder) {
                    throw new Error(`Note folder not found: ${id}. Use tulcase_list_notes to find valid folder IDs.`);
                }
                folder.name = requireName(name, 'Folder name');
                await store.write(this.settings.listsFile, data);
                this.refresh();
                return json({ renamed: folder });
            }
            case 'delete': {
                if (!id) { throw new Error('Folder id is required for delete.'); }
                const folder = data.folders.find(entry => entry.id === id);
                if (!folder) {
                    throw new Error(`Note folder not found: ${id}. Use tulcase_list_notes to find valid folder IDs.`);
                }
                const notesInFolder = data.notes.filter(note => note.folder === id);
                const subFolders = data.folders.filter(entry => entry.parent === id);
                for (const note of notesInFolder) { note.folder = ''; }
                for (const entry of subFolders) { entry.parent = ''; }
                data.folders = data.folders.filter(entry => entry.id !== id);
                await store.write(this.settings.listsFile, data);
                this.refresh();
                return json({
                    deleted: { id: folder.id, name: folder.name },
                    movedToRoot: { notes: notesInFolder.length, folders: subFolders.length },
                });
            }
        }
    }
}

interface MoveNoteEntryInput {
    id: string;
    targetFolderId?: string;
}

class MoveNoteEntryTool implements vscode.LanguageModelTool<MoveNoteEntryInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<MoveNoteEntryInput>) {
        const data = await store.read<NoteStore>(this.settings.listsFile, { notes: [], folders: [] });
        const targetFolderId = options.input.targetFolderId ?? '';
        const note = data.notes.find(entry => entry.id === options.input.id);

        if (note) {
            if (!moveFlatItem(data.notes, data.folders, note.id, targetFolderId)) {
                throw new Error(`Unable to move note ${note.id} to folder ${targetFolderId || '(root)'}.`);
            }
            note.updatedAt = new Date().toISOString().slice(0, 10);
            await store.write(this.settings.listsFile, data);
            this.refresh();
            return json({ moved: { kind: 'note', id: note.id, targetFolderId } });
        }

        const folder = data.folders.find(entry => entry.id === options.input.id);
        if (!folder) {
            throw new Error(`Note entry not found: ${options.input.id}. Use tulcase_list_notes to find valid note and folder IDs.`);
        }
        if (!moveFlatFolder(data.folders, folder.id, targetFolderId)) {
            throw new Error(`Unable to move note folder ${folder.id} to folder ${targetFolderId || '(root)'}.`);
        }

        await store.write(this.settings.listsFile, data);
        this.refresh();
        return json({ moved: { kind: 'folder', id: folder.id, targetFolderId } });
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

interface ManageLinkFolderInput {
    action: 'create' | 'rename' | 'delete';
    id?: string;
    name?: string;
    parentFolderId?: string;
}

class ManageLinkFolderTool implements vscode.LanguageModelTool<ManageLinkFolderInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ManageLinkFolderInput>) {
        const data = await store.read<LinkStore>(this.settings.linksFile, { root: [] });
        const { action, id, name, parentFolderId } = options.input;

        switch (action) {
            case 'create': {
                const folder: LinkNode = {
                    id: generateId('lf'),
                    type: 'folder',
                    label: requireName(name, 'Folder name'),
                    expanded: true,
                    children: [],
                };
                const parentId = parentFolderId ?? '';
                if (parentId) {
                    const parent = findNode(data.root, parentId);
                    if (!parent || parent.type !== 'folder') {
                        throw new Error(`Link folder not found: ${parentId}. Use tulcase_list_links to find valid folder IDs.`);
                    }
                    parent.children ??= [];
                    parent.children.push(folder);
                } else {
                    data.root.push(folder);
                }
                await store.write(this.settings.linksFile, data);
                this.refresh();
                return json({ created: folder });
            }
            case 'rename': {
                if (!id) { throw new Error('Folder id is required for rename.'); }
                const folder = findNode(data.root, id);
                if (!folder || folder.type !== 'folder') {
                    throw new Error(`Link folder not found: ${id}. Use tulcase_list_links to find valid folder IDs.`);
                }
                folder.label = requireName(name, 'Folder name');
                await store.write(this.settings.linksFile, data);
                this.refresh();
                return json({ renamed: folder });
            }
            case 'delete': {
                if (!id) { throw new Error('Folder id is required for delete.'); }
                const folder = findNode(data.root, id);
                if (!folder || folder.type !== 'folder') {
                    throw new Error(`Link folder not found: ${id}. Use tulcase_list_links to find valid folder IDs.`);
                }
                removeNode(data.root, id);
                await store.write(this.settings.linksFile, data);
                this.refresh();
                return text(`Deleted link folder "${folder.label}" and its nested entries.`);
            }
        }
    }
}

interface MoveLinkEntryInput {
    id: string;
    targetFolderId?: string;
}

class MoveLinkEntryTool implements vscode.LanguageModelTool<MoveLinkEntryInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<MoveLinkEntryInput>) {
        const data = await store.read<LinkStore>(this.settings.linksFile, { root: [] });
        const targetFolderId = options.input.targetFolderId ?? '';
        const node = findNode(data.root, options.input.id);
        if (!node) {
            throw new Error(`Link entry not found: ${options.input.id}. Use tulcase_list_links to find valid link and folder IDs.`);
        }
        if (!moveNode(data.root, node.id, targetFolderId)) {
            throw new Error(`Unable to move link entry ${node.id} to folder ${targetFolderId || '(root)'}.`);
        }
        await store.write(this.settings.linksFile, data);
        this.refresh();
        return json({ moved: { kind: node.type, id: node.id, targetFolderId } });
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
        const folderId = options.input.folder ?? '';
        requireCommandFolder(data, folderId);
        const item: CommandItem = {
            id: generateId('cmd'),
            label: options.input.label,
            command: options.input.command,
            tags: options.input.tags ?? [],
            folder: folderId,
        };
        data.items.push(item);
        await store.write(this.settings.commandsFile, data);
        this.refresh();
        return json({ created: item });
    }
}

interface EditCommandInput { id: string; label?: string; command?: string; tags?: string[]; folder?: string }

class EditCommandTool implements vscode.LanguageModelTool<EditCommandInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<EditCommandInput>) {
        const data = await store.read<CommandStore>(this.settings.commandsFile, { items: [], folders: [] });
        const item = data.items.find(c => c.id === options.input.id);
        if (!item) { throw new Error(`Command not found: ${options.input.id}. Use tulcase_list_commands to find valid IDs.`); }

        if (options.input.label !== undefined) { item.label = options.input.label; }
        if (options.input.command !== undefined) { item.command = options.input.command; }
        if (options.input.tags !== undefined) { item.tags = options.input.tags; }
        if (options.input.folder !== undefined) {
            requireCommandFolder(data, options.input.folder);
            item.folder = options.input.folder;
        }

        await store.write(this.settings.commandsFile, data);
        this.refresh();
        return json({ updated: item });
    }
}

interface ManageCommandFolderInput {
    action: 'create' | 'rename' | 'delete';
    id?: string;
    name?: string;
    parentId?: string;
}

class ManageCommandFolderTool implements vscode.LanguageModelTool<ManageCommandFolderInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<ManageCommandFolderInput>) {
        const data = await store.read<CommandStore>(this.settings.commandsFile, { items: [], folders: [] });
        const folders = data.folders ?? [];
        data.folders = folders;
        const { action, id, name, parentId } = options.input;

        switch (action) {
            case 'create': {
                const folderName = requireName(name, 'Folder name');
                const parent = parentId ?? '';
                requireCommandFolder(data, parent);
                const folder: CommandFolder = {
                    id: generateId('cf'),
                    name: folderName,
                    parent,
                };
                folders.push(folder);
                await store.write(this.settings.commandsFile, data);
                this.refresh();
                return json({ created: folder });
            }
            case 'rename': {
                if (!id) { throw new Error('Folder id is required for rename.'); }
                const folder = folders.find(entry => entry.id === id);
                if (!folder) {
                    throw new Error(`Command folder not found: ${id}. Use tulcase_list_commands to find valid folder IDs.`);
                }
                folder.name = requireName(name, 'Folder name');
                await store.write(this.settings.commandsFile, data);
                this.refresh();
                return json({ renamed: folder });
            }
            case 'delete': {
                if (!id) { throw new Error('Folder id is required for delete.'); }
                const folder = folders.find(entry => entry.id === id);
                if (!folder) {
                    throw new Error(`Command folder not found: ${id}. Use tulcase_list_commands to find valid folder IDs.`);
                }
                const commandsInFolder = data.items.filter(item => item.folder === id);
                const subFolders = folders.filter(entry => entry.parent === id);
                for (const item of commandsInFolder) { item.folder = folder.parent; }
                for (const entry of subFolders) { entry.parent = folder.parent; }
                data.folders = folders.filter(entry => entry.id !== id);
                await store.write(this.settings.commandsFile, data);
                this.refresh();
                return json({
                    deleted: { id: folder.id, name: folder.name },
                    rehomedToParent: { commands: commandsInFolder.length, folders: subFolders.length, parentId: folder.parent },
                });
            }
        }
    }
}

interface MoveCommandEntryInput {
    id: string;
    targetFolderId?: string;
}

class MoveCommandEntryTool implements vscode.LanguageModelTool<MoveCommandEntryInput> {
    constructor(private settings: TulcaseSettings, private refresh: Refresher) {}

    async invoke(options: vscode.LanguageModelToolInvocationOptions<MoveCommandEntryInput>) {
        const data = await store.read<CommandStore>(this.settings.commandsFile, { items: [], folders: [] });
        const folders = data.folders ?? [];
        data.folders = folders;
        const targetFolderId = options.input.targetFolderId ?? '';
        const item = data.items.find(entry => entry.id === options.input.id);

        if (item) {
            if (!moveFlatItem(data.items, folders, item.id, targetFolderId)) {
                throw new Error(`Unable to move command ${item.id} to folder ${targetFolderId || '(root)'}.`);
            }
            await store.write(this.settings.commandsFile, data);
            this.refresh();
            return json({ moved: { kind: 'command', id: item.id, targetFolderId } });
        }

        const folder = folders.find(entry => entry.id === options.input.id);
        if (!folder) {
            throw new Error(`Command entry not found: ${options.input.id}. Use tulcase_list_commands to find valid command and folder IDs.`);
        }
        if (!moveFlatFolder(folders, folder.id, targetFolderId)) {
            throw new Error(`Unable to move command folder ${folder.id} to folder ${targetFolderId || '(root)'}.`);
        }

        await store.write(this.settings.commandsFile, data);
        this.refresh();
        return json({ moved: { kind: 'folder', id: folder.id, targetFolderId } });
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
        vscode.lm.registerTool('tulcase_manage_note_folder', new ManageNoteFolderTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_move_note_entry', new MoveNoteEntryTool(settings, refresh)),
        // Links
        vscode.lm.registerTool('tulcase_list_links', new ListLinksTool(settings)),
        vscode.lm.registerTool('tulcase_add_link', new AddLinkTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_edit_link', new EditLinkTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_manage_link_folder', new ManageLinkFolderTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_move_link_entry', new MoveLinkEntryTool(settings, refresh)),
        // Commands
        vscode.lm.registerTool('tulcase_list_commands', new ListCommandsTool(settings)),
        vscode.lm.registerTool('tulcase_add_command', new AddCommandTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_edit_command', new EditCommandTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_manage_command_folder', new ManageCommandFolderTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_move_command_entry', new MoveCommandEntryTool(settings, refresh)),
        // Tags
        vscode.lm.registerTool('tulcase_list_tags', new ListTagsTool(settings)),
        vscode.lm.registerTool('tulcase_add_tag', new AddTagTool(settings, refresh)),
        vscode.lm.registerTool('tulcase_manage_tag', new ManageTagTool(settings, refresh)),
    );
}

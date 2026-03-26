import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Resolved file-system paths for all Tulcase data stores.
 * Mirrors Python's config.py Settings dataclass.
 */
export interface TulcaseSettings {
    baseDir: string;
    todosFile: string;
    tagsFile: string;
    recurringFile: string;
    commandsFile: string;
    linksFile: string;
    listsFile: string;
    recordsDir: string;
    todoPage: string;
}

/**
 * Resolve the base data directory from VS Code settings or platform default.
 */
function resolveBaseDir(): string {
    const config = vscode.workspace.getConfiguration('tulcase');
    const configured = config.get<string>('dataDirectory', '').trim();
    const legacyConfigured = vscode.workspace.getConfiguration('arbeitsplatz')
        .get<string>('dataDirectory', '').trim();

    if (configured) {
        // Expand ~ to home directory
        if (configured.startsWith('~')) {
            return path.join(os.homedir(), configured.slice(1));
        }
        return configured;
    }

    if (legacyConfigured) {
        if (legacyConfigured.startsWith('~')) {
            return path.join(os.homedir(), legacyConfigured.slice(1));
        }
        return legacyConfigured;
    }

    // Platform-specific default
    if (process.platform === 'win32') {
        return path.join(process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming'), 'tulcase');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'tulcase');
    }
    return path.join(os.homedir(), '.local', 'share', 'tulcase');
}

/**
 * Copy the legacy Arbeitsplatz data directory to the new Tulcase directory
 * if the new location does not exist yet.
 */
function migrateLegacyBaseDir(baseDir: string): void {
    if (fs.existsSync(baseDir)) {
        return;
    }

    const legacyBaseDir = path.join(
        process.platform === 'win32'
            ? (process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming'))
            : process.platform === 'darwin'
                ? path.join(os.homedir(), 'Library', 'Application Support')
                : path.join(os.homedir(), '.local', 'share'),
        'arbeitsplatz',
    );

    if (!fs.existsSync(legacyBaseDir)) {
        return;
    }

    fs.mkdirSync(path.dirname(baseDir), { recursive: true });
    fs.cpSync(legacyBaseDir, baseDir, { recursive: true });
}

/**
 * Build a complete Settings object from the resolved base directory.
 */
export function buildSettings(baseDir?: string): TulcaseSettings {
    const base = baseDir || resolveBaseDir();
    migrateLegacyBaseDir(base);
    return {
        baseDir: base,
        todosFile: path.join(base, 'todo_db', 'todos.json'),
        tagsFile: path.join(base, 'tags_db', 'tags.json'),
        recurringFile: path.join(base, 'todo_db', 'recurring.json'),
        commandsFile: path.join(base, 'commands_db', 'commands.json'),
        linksFile: path.join(base, 'links_db', 'links.json'),
        listsFile: path.join(base, 'lists_db', 'lists.json'),
        recordsDir: path.join(base, 'records_db'),
        todoPage: path.join(base, 'notes', 'todos.md'),
    };
}

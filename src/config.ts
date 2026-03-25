import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

/**
 * Resolved file-system paths for all Arbeitsplatz data stores.
 * Mirrors Python's config.py Settings dataclass.
 */
export interface ArbeitsplatzSettings {
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
    const config = vscode.workspace.getConfiguration('arbeitsplatz');
    const configured = config.get<string>('dataDirectory', '').trim();

    if (configured) {
        // Expand ~ to home directory
        if (configured.startsWith('~')) {
            return path.join(os.homedir(), configured.slice(1));
        }
        return configured;
    }

    // Platform-specific default
    if (process.platform === 'win32') {
        return path.join(process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming'), 'arbeitsplatz');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'arbeitsplatz');
    }
    return path.join(os.homedir(), '.local', 'share', 'arbeitsplatz');
}

/**
 * Build a complete Settings object from the resolved base directory.
 */
export function buildSettings(baseDir?: string): ArbeitsplatzSettings {
    const base = baseDir || resolveBaseDir();
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

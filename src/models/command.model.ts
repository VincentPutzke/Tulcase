/** A single command/snippet entry */
export interface CommandEntry {
    command: string;
    tags: string[];
}

/** Root shape of commands.json */
export interface CommandStore {
    commands: Record<string, CommandEntry>;
}

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Generic JSON file storage — mirrors Python's json_store.py.
 * Provides read/write with auto-directory creation and atomic writes.
 */
export class JsonStore {
    /**
     * Read a JSON file, returning `fallback` if missing or empty.
     * Creates the file with the fallback value if it doesn't exist.
     */
    async read<T>(filePath: string, fallback: T): Promise<T> {
        try {
            const text = await fs.readFile(filePath, 'utf-8');
            const trimmed = text.trim();
            if (!trimmed) {
                return fallback;
            }
            return JSON.parse(trimmed) as T;
        } catch (err: unknown) {
            if (isNodeError(err) && err.code === 'ENOENT') {
                await this.write(filePath, fallback);
                return fallback;
            }
            // For corrupt JSON, return fallback rather than crashing
            if (err instanceof SyntaxError) {
                return fallback;
            }
            throw err;
        }
    }

    /**
     * Write data as pretty-printed JSON with atomic temp-then-rename pattern.
     */
    async write(filePath: string, data: unknown): Promise<void> {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });

        const json = JSON.stringify(data, null, 2);
        const tmpPath = filePath + '.tmp';

        await fs.writeFile(tmpPath, json, 'utf-8');

        try {
            await fs.rename(tmpPath, filePath);
        } catch {
            // Windows: rename may fail if target exists
            try {
                await fs.unlink(filePath);
            } catch {
                // Target may not exist
            }
            await fs.rename(tmpPath, filePath);
        }
    }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
    return err instanceof Error && 'code' in err;
}

// @ts-check
import esbuild from 'esbuild';
import * as sass from 'sass';
import * as fs from 'node:fs';
import * as path from 'node:path';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    minify: false,
    // Prefer ESM package entries: jsonc-parser's CJS entry is a UMD build
    // whose internal requires esbuild cannot inline (breaks at runtime).
    mainFields: ['module', 'main'],
};

/**
 * Compile SCSS → CSS and copy the compiled CSS + HTML template into out/.
 * Called before every esbuild pass so the webview assets are always up-to-date.
 */
function buildWebviewAssets() {
    fs.mkdirSync('out', { recursive: true });

    // All webview asset pairs: { scss, html, name }
    const webviews = [
        { name: 'record-calendar' },
        { name: 'todo-list' },
        { name: 'command-list' },
        { name: 'note-list' },
        { name: 'link-list' },
        { name: 'tag-list' },
        { name: 'sync-panel' },
        { name: 'pipe-pipelines' },
        { name: 'pipe-scopes' },
    ];

    for (const wv of webviews) {
        // Compile SCSS → CSS
        const scssResult = sass.compile(`src/views/${wv.name}.scss`, {
            style: 'compressed',
        });
        fs.writeFileSync(`out/${wv.name}.css`, scssResult.css, 'utf-8');

        // Copy HTML template verbatim (tokens are substituted at runtime in TS)
        fs.copyFileSync(
            path.join('src', 'views', `${wv.name}.html`),
            path.join('out', `${wv.name}.html`),
        );
    }

    console.log('Webview assets built (SCSS + HTML).');
}

async function main() {
    buildWebviewAssets();

    if (isWatch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('Watching for changes...');
    } else {
        await esbuild.build(buildOptions);
        console.log('Build complete.');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

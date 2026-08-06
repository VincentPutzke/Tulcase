import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(join(__dirname, '..', 'views', 'gitlab-packages.html'), 'utf8');

describe('gitlab-packages webview markup', () => {
    it('does not render the standalone top refresh toolbar', () => {
        expect(html).not.toContain('class="add-bar"');
        expect(html).not.toContain('id="btn-refresh"');
    });

    it('uses Pipeline-style section roots and plain child row toggles', () => {
        expect(html).toContain('class="section-header package-scope-header"');
        expect(html).toContain('class="section-body');
        expect(html).toContain('class="tree-item-row"');
        expect(html).not.toContain('data-action="toggle"');
    });
});

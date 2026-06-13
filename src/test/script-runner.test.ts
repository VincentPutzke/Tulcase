import { describe, it, expect } from 'vitest';
import { isTrustedScript } from '../utils/script-trust';

describe('isTrustedScript — run-confirmation trust marker', () => {
    it('trusts a script whose first line carries the marker', () => {
        expect(isTrustedScript('# tulcase: no-confirm\necho hi')).toBe(true);
    });

    it('accepts the hyphen-less spelling', () => {
        expect(isTrustedScript('# tulcase: noconfirm\necho hi')).toBe(true);
    });

    it('matches the marker on a later comment line', () => {
        const body = '#!/usr/bin/env bash\nset -e\n# tulcase: no-confirm\necho hi';
        expect(isTrustedScript(body)).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isTrustedScript('# TULCASE: NO-CONFIRM')).toBe(true);
    });

    it('tolerates leading whitespace and extra comment text', () => {
        expect(isTrustedScript('   #   tulcase: no-confirm  (trusted)')).toBe(true);
    });

    it('does NOT trust a plain script', () => {
        expect(isTrustedScript('#!/usr/bin/env bash\nrm -rf /tmp/x')).toBe(false);
    });

    it('does NOT trust the marker outside a comment', () => {
        expect(isTrustedScript('echo "tulcase: no-confirm"')).toBe(false);
    });

    it('does NOT trust an empty body', () => {
        expect(isTrustedScript('')).toBe(false);
    });
});

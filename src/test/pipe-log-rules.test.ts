import { describe, it, expect } from 'vitest';
import {
    LogRuleEngine,
    BUILTIN_LOG_RULES,
    mergeRuleDefinitions,
    isBuiltinRule,
    validateRule,
} from '../pipe/log-rules';

describe('LogRuleEngine', () => {
    it('remove mode strips matches and drops empty lines', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions([
            { name: 'strip-ansi', pattern: '\\x1b\\[[0-9;]*m', mode: 'remove' },
        ]);
        const rules = engine.resolve(['strip-ansi']);
        const input = '\x1b[32mhello\x1b[0m\nworld\n\x1b[31m\x1b[0m\nkeep';
        const result = LogRuleEngine.apply(input, rules);
        // The third line was only ANSI — becomes empty → dropped
        expect(result).toBe('hello\nworld\nkeep');
    });

    it('replace mode substitutes matches', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions([
            { name: 'mask-tokens', pattern: 'token=[a-z]+', mode: 'replace', replacement: 'token=***' },
        ]);
        const rules = engine.resolve(['mask-tokens']);
        const result = LogRuleEngine.apply('auth token=secret here\nno token here', rules);
        expect(result).toBe('auth token=*** here\nno token here');
    });

    it('applies multiple rules in order', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions([
            { name: 'r1', pattern: 'AAA', mode: 'replace', replacement: 'BBB' },
            { name: 'r2', pattern: 'BBB', mode: 'replace', replacement: 'CCC' },
        ]);
        const rules = engine.resolve(['r1', 'r2']);
        expect(LogRuleEngine.apply('AAA', rules)).toBe('CCC');
    });

    it('resolves only known rule names', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions([
            { name: 'exists', pattern: 'x', mode: 'remove' },
        ]);
        const rules = engine.resolve(['exists', 'nope', 'also-nope']);
        expect(rules.length).toBe(1);
    });

    it('skips invalid regex patterns', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions([
            { name: 'bad', pattern: '(unclosed', mode: 'remove' },
            { name: 'good', pattern: 'ok', mode: 'remove' },
        ]);
        const rules = engine.resolve(['bad', 'good']);
        expect(rules.length).toBe(1);
    });

    it('returns text unchanged when no rules', () => {
        const input = 'hello\nworld';
        expect(LogRuleEngine.apply(input, [])).toBe(input);
    });

    it('preserves originally-empty lines in remove mode', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions([
            { name: 'strip-x', pattern: 'x', mode: 'remove' },
        ]);
        const rules = engine.resolve(['strip-x']);
        const result = LogRuleEngine.apply('a\n\nb', rules);
        expect(result).toBe('a\n\nb');
    });
});

describe('built-in rules', () => {
    it('all built-in patterns compile and pass validation', () => {
        for (const rule of BUILTIN_LOG_RULES) {
            expect(validateRule(rule), `rule ${rule.name}`).toBeUndefined();
        }
    });

    it('strip-timestamps removes ISO timestamps', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions(mergeRuleDefinitions([]));
        const rules = engine.resolve(['strip-timestamps']);
        const out = LogRuleEngine.apply(
            '2026-06-11T10:30:45.123Z $ npm run build\nplain line', rules,
        );
        expect(out).toBe('$ npm run build\nplain line');
    });

    it('redact-secrets masks assignments', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions(mergeRuleDefinitions([]));
        const rules = engine.resolve(['redact-secrets']);
        const out = LogRuleEngine.apply('export API_KEY=abc123 done\npassword: hunter2', rules);
        expect(out).toContain('API_KEY=*** done');
        expect(out).toContain('password: ***');
    });

    it('shorten-shas trims 40-char hashes', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions(mergeRuleDefinitions([]));
        const rules = engine.resolve(['shorten-shas']);
        const sha = 'a1b2c3d4' + 'e5f60718' + '293a4b5c' + '6d7e8f90' + '11223344';
        expect(LogRuleEngine.apply(`commit ${sha} pushed`, rules))
            .toBe('commit a1b2c3d4 pushed');
    });

    it('custom rules override built-ins with the same name', () => {
        const engine = new LogRuleEngine();
        engine.setDefinitions(mergeRuleDefinitions([
            { name: 'strip-timestamps', pattern: 'XYZ', mode: 'replace', replacement: 'custom' },
        ]));
        const rules = engine.resolve(['strip-timestamps']);
        expect(LogRuleEngine.apply('XYZ', rules)).toBe('custom');
    });

    it('isBuiltinRule recognises shipped names only', () => {
        expect(isBuiltinRule('strip-timestamps')).toBe(true);
        expect(isBuiltinRule('my-own')).toBe(false);
    });
});

describe('validateRule', () => {
    it('rejects missing name / pattern / bad mode', () => {
        expect(validateRule({ pattern: 'x', mode: 'remove' })).toBeTruthy();
        expect(validateRule({ name: 'a', mode: 'remove' })).toBeTruthy();
        expect(validateRule({ name: 'a', pattern: 'x', mode: 'zap' as never })).toBeTruthy();
    });

    it('rejects invalid regex and bad names', () => {
        expect(validateRule({ name: 'a', pattern: '(open', mode: 'remove' })).toMatch(/Invalid regex/);
        expect(validateRule({ name: 'has space', pattern: 'x', mode: 'remove' })).toBeTruthy();
    });

    it('accepts a sane rule', () => {
        expect(validateRule({ name: 'ok-1', pattern: '\\d+', flags: 'gi', mode: 'remove' }))
            .toBeUndefined();
    });
});

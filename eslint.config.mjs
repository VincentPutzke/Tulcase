import tseslint from 'typescript-eslint';

export default tseslint.config(
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        rules: {
            // Allow unused vars prefixed with _
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            // Allow any type in some places during initial development
            '@typescript-eslint/no-explicit-any': 'warn',
            // Allow non-null assertions (common in VS Code extensions)
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
    {
        ignores: ['out/**', 'node_modules/**', '*.mjs'],
    },
);

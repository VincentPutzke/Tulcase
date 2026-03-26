# 07 — Testing & CI Strategy

> How to test the VS Code extension: unit tests, integration tests, end-to-end tests,
> and continuous integration pipeline.

---

## 1. Testing Pyramid

```
                    ┌───────────┐
                    │   E2E     │  ~5 tests
                    │ (vscode-  │  Extension Dev Host
                    │  test)    │
                ┌───┴───────────┴───┐
                │  Integration      │  ~20 tests
                │  (Vitest + mock   │  TreeProviders,
                │   vscode API)     │  Command handlers
            ┌───┴───────────────────┴───┐
            │       Unit Tests          │  ~100+ tests
            │       (Vitest)            │  Data layer, models,
            │                           │  utilities
            └───────────────────────────┘
```

### Test Distribution

| Layer | Framework | Target Modules | Est. Count | Speed |
|-------|-----------|---------------|-----------|-------|
| **Unit** | Vitest | `data/*`, `models/*`, utilities | 100+ | <1s |
| **Integration** | Vitest + mocked `vscode` | `providers/*`, `commands/*` | 20+ | <3s |
| **E2E** | `@vscode/test-electron` | Full activation, command palette, tree views | 5-10 | 10-30s |

---

## 2. Unit Tests

Unit tests cover the data layer — the pure TypeScript logic ported from Python.
These tests have **zero dependency on the VS Code API**.

### 2.1 `json-store.test.ts`

Ported from: `test_services.py`

| Test | Description |
|------|-------------|
| `reads existing JSON file` | Write a file, read it back, verify content |
| `returns default when file missing` | Read non-existent path, get fallback value |
| `creates parent directories on write` | Write to deep nested path, verify dirs created |
| `writes pretty-printed JSON` | Write, read raw text, check 2-space indentation |
| `atomic write: temp file renamed` | Verify the temp-then-rename pattern |
| `handles empty file gracefully` | Create empty file, read returns default |
| `handles corrupt JSON gracefully` | Write invalid JSON, read returns default or throws |

### 2.2 `time-utils.test.ts`

Ported from: `test_services.py` (time parsing tests)

| Test | Input | Expected |
|------|-------|----------|
| `parses plain minutes` | `"90"` | `90` |
| `parses decimal hours` | `"1.5"` | `90` |
| `parses comma decimal` | `"1,5"` | `90` |
| `parses HH:MM` | `"1:30"` | `90` |
| `parses hours suffix` | `"1.5h"` | `90` |
| `parses HH:MM + h` | `"1:30h"` | `90` |
| `throws on empty` | `""` | `Error` |
| `formats minutes to HH:MM` | `90` | `"01:30"` |

### 2.3 `link-tree.test.ts`

Ported from: `test_services.py` (link tree tests)

| Test | Description |
|------|-------------|
| `findNode: finds root-level node` | |
| `findNode: finds deeply nested node` | |
| `findNode: returns null for missing ID` | |
| `removeNode: removes and returns node` | |
| `removeNode: removes nested node` | |
| `removeNode: returns null for missing ID` | |
| `countLinks: counts link types only` | |
| `countLinks: traverses nested folders` | |

### 2.4 `tag-propagation.test.ts`

Ported from: `test_tag_propagation.py`

| Test | Description |
|------|-------------|
| `stripTag: removes from todos` | |
| `stripTag: removes from recurring actions` | |
| `stripTag: removes from commands` | |
| `stripTag: removes from link tree (nested)` | |
| `stripTag: removes from lists + list items` | |
| `renameTag: renames in all stores` | |
| `renameTag: handles tag not present (no-op)` | |
| `handles missing files gracefully` | |

### 2.5 `recurring-sync.test.ts`

Ported from: `test_recurring_generation.py`

| Test | Description |
|------|-------------|
| `daily schedule matches every day` | |
| `weekly schedule matches correct weekday` | |
| `weekly schedule skips wrong weekday` | |
| `monthly schedule matches weekday + week-of-month` | |
| `idempotent: no duplicate todo on second run` | |
| `respects lastCreatedDate` | |
| `inactive actions are skipped` | |
| `normalizes legacy action format` | |
| `creates todo with correct tags` | |

### 2.6 Test Fixtures

```typescript
// test/fixtures.ts

export function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tulcase-test-'));
}

export function seedTodos(baseDir: string, items: TodoItem[]): void {
    const filePath = path.join(baseDir, 'todo_db', 'todos.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ items }, null, 2));
}

export function seedTags(baseDir: string, tags: Record<string, TagDef>): void { ... }
export function seedCommands(baseDir: string, commands: Record<string, CommandEntry>): void { ... }
export function seedLinks(baseDir: string, root: LinkNode[]): void { ... }
export function seedLists(baseDir: string, lists: MiniList[]): void { ... }
export function seedRecords(baseDir: string, year: number, month: number, days: Record<string, RecordEntry[]>): void { ... }
```

---

## 3. Integration Tests

Integration tests verify that tree providers, command handlers, and webview message
handlers work correctly with a mocked VS Code API.

### 3.1 VS Code API Mock

```typescript
// test/mocks/vscode-mock.ts
// Provides stubs for: 
//   vscode.window.showInputBox
//   vscode.window.showQuickPick
//   vscode.window.showWarningMessage
//   vscode.env.clipboard.writeText
//   vscode.commands.executeCommand
//   vscode.EventEmitter
//   vscode.TreeItem
```

### 3.2 Tree Provider Tests

| Provider | Test | Description |
|----------|------|-------------|
| `TodoTreeProvider` | `groups by date bucket` | Seed 5 todos with different dates; verify tree has correct groups |
| `TodoTreeProvider` | `filters done items` | Toggle done filter; verify tree omits done items |
| `TodoTreeProvider` | `shows tag in description` | Seed todo with tags; verify TreeItem.description |
| `CommandTreeProvider` | `lists all commands` | Seed 3 commands; verify 3 tree items |
| `LinkTreeProvider` | `renders nested folders` | Seed folder→link structure; verify collapsible state |
| `ListTreeProvider` | `shows progress count` | Seed list with 2/5 done; verify description = "2/5" |

### 3.3 Command Handler Tests

| Command | Test | Description |
|---------|------|-------------|
| `todo.add` | `creates todo in file` | Mock InputBox; verify todos.json updated |
| `todo.markDone` | `sets done=true` | Call with tree item; verify file updated |
| `todo.delete` | `removes from file` | Mock confirmation; verify item removed |
| `command.copy` | `copies to clipboard` | Call with tree item; verify clipboard.writeText called |
| `command.runInTerminal` | `sends to terminal` | Mock activeTerminal; verify sendText called |
| `link.addLink` | `adds to correct folder` | Mock QuickPick; verify link tree updated |
| `record.add` | `adds to correct month file` | Mock InputBox; verify records file updated |

---

## 4. End-to-End Tests

E2E tests run in a real Extension Development Host using `@vscode/test-electron`.

```typescript
// test/e2e/extension.test.ts

import * as vscode from 'vscode';
import { expect } from 'chai';

suite('Extension E2E', () => {
    test('extension activates successfully', async () => {
        const ext = vscode.extensions.getExtension('your-publisher.tulcase');
        await ext?.activate();
        expect(ext?.isActive).to.be.true;
    });

    test('todo tree view is registered', async () => {
        // Verify the tree view appears
        await vscode.commands.executeCommand('tulcase.todos.focus');
        // Tree view should be visible
    });

    test('add todo command works end-to-end', async () => {
        // This test requires mocking the InputBox — E2E tests
        // are limited in UI interaction capabilities.
        // Focus on: command registered, no errors on execution.
    });

    test('status bar item shows todo count', async () => {
        // Verify status bar item is registered and shows correct count.
    });
});
```

### E2E Limitations

VS Code's test API cannot easily:
- Type into InputBox/QuickPick (no UI automation).
- Click tree items (no DOM access).
- Verify webview content (sandboxed iframe).

**Recommendation**: Keep E2E tests focused on activation, command registration, and
error-free execution. Trust unit + integration tests for logic correctness.

---

## 5. Test Configuration

### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/test/suite/**/*.test.ts'],
        exclude: ['src/test/e2e/**'],
        coverage: {
            provider: 'v8',
            include: ['src/data/**', 'src/models/**', 'src/providers/**', 'src/commands/**'],
            thresholds: {
                statements: 90,
                branches: 85,
                functions: 90,
                lines: 90,
            },
        },
    },
});
```

### `.vscode/launch.json` (Debug Tests)

```json
{
    "configurations": [
        {
            "name": "Extension Tests",
            "type": "extensionHost",
            "request": "launch",
            "runtimeExecutable": "${execPath}",
            "args": [
                "--extensionDevelopmentPath=${workspaceFolder}",
                "--extensionTestsPath=${workspaceFolder}/out/test/e2e"
            ]
        }
    ]
}
```

---

## 6. CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Unit + Integration Tests
        run: npm run test:unit -- --coverage

      - name: E2E Tests (Linux only)
        if: runner.os == 'Linux'
        run: |
          # E2E tests need a display server on Linux
          xvfb-run -a npm run test:e2e

      - name: Upload coverage
        if: matrix.os == 'ubuntu-latest' && matrix.node == 20
        uses: codecov/codecov-action@v4
        with:
          file: coverage/lcov.info

  package:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build
      - run: npx @vscode/vsce package
      - uses: actions/upload-artifact@v4
        with:
          name: tulcase.vsix
          path: '*.vsix'
```

---

## 7. Quality Gates

| Gate | Tool | Threshold | When |
|------|------|-----------|------|
| Lint (no errors) | ESLint + Prettier | 0 errors | Every commit |
| Type check | TypeScript `--noEmit` | 0 errors | Every commit |
| Unit tests pass | Vitest | 100% pass | Every push |
| Line coverage | V8 via Vitest | ≥90% | Every push |
| Branch coverage | V8 via Vitest | ≥85% | Every push |
| E2E tests pass | @vscode/test-electron | 100% pass | Every push (Linux) |
| VSIX builds | @vscode/vsce | No packaging errors | main branch |
| Cross-platform | GitHub Actions matrix | Win + Mac + Linux | Every push |
| Bundle size | Custom script | <2 MB VSIX | On package |

---

## 8. `package.json` Scripts

```json
{
    "scripts": {
        "build": "esbuild src/extension.ts --bundle --outfile=out/extension.js --external:vscode --format=cjs --platform=node",
        "build:webview": "esbuild webview-ui/main.ts --bundle --outfile=out/webview.js --format=iife",
        "watch": "npm run build -- --watch",
        "lint": "eslint src/ --ext .ts",
        "lint:fix": "eslint src/ --ext .ts --fix",
        "typecheck": "tsc --noEmit",
        "test:unit": "vitest run",
        "test:unit:watch": "vitest watch",
        "test:e2e": "node out/test/e2e/runTest.js",
        "test": "npm run test:unit && npm run test:e2e",
        "package": "vsce package",
        "publish": "vsce publish"
    }
}
```

---

## 9. Test Porting Strategy

The existing Python test suite (12 files, ~950 lines) provides excellent test cases
that can be directly translated:

| Python Test File | TypeScript Target | Porting Effort |
|-----------------|-------------------|---------------|
| `test_todos.py` | `todo-commands.test.ts` | Medium (needs mock InputBox) |
| `test_tags.py` | `tag-propagation.test.ts` + `tag-commands.test.ts` | Medium |
| `test_commands.py` | `command-commands.test.ts` | Low |
| `test_links.py` | `link-tree.test.ts` + `link-commands.test.ts` | Medium (tree operations) |
| `test_lists.py` | `list-commands.test.ts` | Low |
| `test_records.py` | `record-commands.test.ts` | Low |
| `test_recurring.py` | `recurring-sync.test.ts` | Medium |
| `test_recurring_generation.py` | `recurring-sync.test.ts` | Already covered above |
| `test_tag_propagation.py` | `tag-propagation.test.ts` | Medium |
| `test_services.py` | `json-store.test.ts` + `link-tree.test.ts` + `time-utils.test.ts` | Low |
| `conftest.py` | `test/fixtures.ts` | Low |

**Estimated total**: ~800 lines of TypeScript tests (from ~950 Python lines).

---

*Next: [08-USE-CASES.md](08-USE-CASES.md) — Detailed use cases and user stories.*

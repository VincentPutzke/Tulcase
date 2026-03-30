# Architecture Notes

Tulcase is intentionally simple in its storage model and practical in its extension architecture.

## Main Technical Shape

- VS Code extension written in TypeScript
- bundled with `esbuild`
- tested with `vitest`
- local JSON storage instead of a database server
- native VS Code APIs plus focused webviews where richer UI matters

## Current UI Model

Tulcase mixes two UI strategies:

- tree-style and list-style productivity panels presented as webviews
- VS Code-native quick picks, commands, status bar, and document integration

This keeps the UX rich where needed but still aligned with the editor.

## Data Layout

Tulcase stores its data in named databases under a root directory.

At a high level the structure looks like this:

```text
data/
  default/
    todo_db/
    tags_db/
    commands_db/
    links_db/
    lists_db/
    records_db/
```

This design keeps import, export, switching, and backup workflows straightforward.

## Architectural Priorities

### 1. Local-first reliability

The extension reads and writes plain JSON files so the user keeps direct control over their data.

### 2. Fast interaction loops

Common actions should complete with minimal prompts and minimal context switching.

### 3. Cross-module consistency

Tags, storage patterns, and inline actions should behave consistently across modules.

### 4. Practical extensibility

New modules should fit the existing model without requiring a full redesign.

## Important Building Blocks

- `src/extension.ts` registers views, commands, decorators, watchers, and refresh flows.
- `src/views/` contains the webview providers and templates for user-facing modules.
- `src/data/` contains storage, transformation, sync, and utility helpers.
- `src/models/` defines the data contracts.
- `src/commands/` contains command-palette and action orchestration.

## Why JSON Fits Here

JSON is a reasonable fit because Tulcase is built for personal or small-scale local workflows where:

- transparency matters
- backup and migration should be simple
- a server dependency is unnecessary
- hand-editing and inspection are occasionally useful

## Where Complexity Actually Lives

The hard parts are not storage. They are behavior and polish:

- keeping actions discoverable but not noisy
- maintaining fast webview interactions
- preserving shared styling and interaction contracts
- handling recurring items and tag propagation safely
- keeping the product useful without turning it into a cluttered dashboard

## Documentation Strategy

The repository uses two levels of documentation:

- the root README for repository orientation
- the `docs/` folder for durable product and workflow guidance

That split keeps GitHub visitors productive without forcing every detail into a single landing page.
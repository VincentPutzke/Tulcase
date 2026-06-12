# Tulcase

Tulcase is a VS Code extension for developers who want their personal productivity system directly inside the editor.

Instead of spreading work across browser tabs, sticky notes, temporary files, and terminal history, Tulcase keeps the supporting pieces of development work inside VS Code:

- todos
- notes
- saved commands
- links
- tags
- time records
- recurring tasks
- multiple local databases

It is designed as a practical local-first companion:

- fast enough for daily use
- keyboard-first for developer workflows
- file-based so your data stays inspectable and portable
- integrated with VS Code instead of fighting it

## A VS Code Extension

Tulcase is not a separate web app wrapped around your workflow.

It is built to feel like part of VS Code:

- work from the Activity Bar and panel views
- trigger actions from the command palette
- keep context next to the code you are editing
- stay in one environment while planning, executing, and tracking work

The point is simple: less context switching, less repeated friction, and faster everyday development work.

## What It Does

Tulcase provides these core modules inside VS Code:

- TODOs with date buckets, quick add, tagging, postpone, and done flows
- Notes with folders, metadata editing, markdown editing, and tag decorations
- Commands with saved snippets, copy, and terminal insertion
- Links with nested folders and inline open/edit actions
- Tags with global color/category management and propagation
- Records with a calendar-style time logging view
- Databases with import, export, switching, and update commands
- Pipe: GitLab pipelines with live job logs, run/retry/cancel actions, form-based
  scopes with follow notifications, and regex log rules (see `docs/pipe.md`)

## Why It Exists

Tulcase is for the developer who keeps context in the editor and does not want a browser tab for every tiny operational task.

The product goal is simple:

> save time, reduce context switching, and keep everyday developer support tools close to the code.

## Daily Workflow Highlights

- Capture todos without leaving the editor.
- Keep reusable shell commands where you can copy or insert them in seconds.
- Store links that belong to the codebase you are working on.
- Take lightweight project notes without switching tools.
- Track time directly from the same environment where the work happened.
- Maintain multiple Tulcase databases for different contexts.
- Watch GitLab pipelines, stream job logs into the editor, and trigger or retry
  pipelines without opening the browser.

## Docs

The repository includes a plain GitHub documentation set in `docs/`.

- `docs/README.md`
- `docs/getting-started.md`
- `docs/workflows-and-hacks.md`
- `docs/architecture.md`
- `docs/pipe.md`
- `docs/roadmap.md`
- `docs/releasing.md`

## Release Status

Current release line: `1.4.1`

See `CHANGELOG.md` for release history.


## For Developers

This section is for working on the extension itself.

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run compile
```

### Test

```bash
npm test
```

### Package

```bash
npm run package
```

### Run in VS Code

Open the Tulcase workspace in VS Code and press `F5` to launch an Extension Development Host.

### Repository Structure

- `src/` extension source code
- `out/` bundled output
- `media/` icons and static assets
- `docs/` repository documentation
- `vscode-working-tool/` planning and migration notes

### Release Automation

Tulcase includes upstream GitHub Actions automation for:

- CI test and build validation on pushes and pull requests
- automatic version sync on pushes to `feature/*`, `fix/*`, `hotfix/*`, `develop`, and `main`
- manual release dispatch from GitHub Actions for publishing and major releases
- automatic tag creation
- automatic GitHub Release publishing
- automatic `.vsix` upload as a release asset

See `docs/releasing.md` for the operational release flow.


## Documentation Intent

The README is the fast overview.

The `docs/` folder is the deeper reference for:

- onboarding
- workflows
- architecture
- practical usage patterns
- future ideas worth building
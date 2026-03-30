# Getting Started

## Install From Source

```bash
npm install
npm run compile
```

To run the extension locally, open the repository in VS Code and press `F5`.

## Run Tests

```bash
npm test
```

## Package a VSIX

```bash
npm run package
```

## Data Location

Tulcase stores data in a user-space directory and supports switching between named databases.

Typical default base directories:

- Windows: `%APPDATA%/tulcase`
- macOS: `~/Library/Application Support/tulcase`
- Linux: `~/.local/share/tulcase`

You can override the root path with the `tulcase.dataDirectory` setting.

## First Useful Setup

After installing Tulcase, do these first:

1. Create or switch to the database you want to use.
2. Add a few tags for your common contexts.
3. Save your most repeated terminal commands.
4. Add one or two link folders for active projects.
5. Start capturing todos directly from the keyboard.

## Recommended Defaults

For a single developer, this setup works well:

- one main database for day-to-day work
- tags by context, not by novelty
- notes grouped by project or area
- commands named by intent, not by exact syntax

## Suggested Naming Patterns

### Tags

- `#project:client-a`
- `#area:backend`
- `#priority:urgent`
- `#type:bug`

### Command labels

- `Run backend locally`
- `Open local logs`
- `Build release package`
- `Reset test data`

### Note folders

- `Active Projects`
- `Operations`
- `Release Notes`
- `Snippets and References`

## Good First Workflows

- Use TODOs for near-term execution.
- Use Notes for explanations, checklists, and operating knowledge.
- Use Commands for repeatable terminal actions.
- Use Links for pages that belong to the work, not generic browsing.

## What Makes Tulcase Valuable

The tool is strongest when it becomes an extension of how you already work in VS Code, not a separate process you have to remember to maintain.
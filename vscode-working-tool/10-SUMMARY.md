# Arbeitsplatz VS Code Extension — Project Documentation

> **A complete planning & design document suite** for migrating the Arbeitsplatz
> web application into a native Visual Studio Code extension.
>
> Generated: 2026-03-16 · Based on full codebase analysis of Arbeitsplatz v1.0.0

---

## Executive Summary

**What**: Build a VS Code extension that replicates the entire Arbeitsplatz productivity
suite (TODOs, time records, bookmarks, command snippets, lists, tags) inside the editor.

**Why**: Developers live in VS Code — switching to a browser tab breaks flow. The extension
delivers the same features with native keyboard-first UX, command palette integration,
and sidebar tree views.

**How**: TypeScript extension that reads/writes the same JSON files as the existing Python
backend. No server required. All business logic (tag propagation, recurring sync, link
tree operations) is ported to TypeScript. Webview panels handle complex views (calendar,
dashboard). File watchers enable multi-instance support.

**Effort**: ~23 developer-days across 4 phases. The data layer port is ~660 lines of
TypeScript. The biggest investments are tree view providers and webview panels.

**Risk**: The hardest challenge is multi-instance concurrent writes, solved progressively
(atomic writes → lockfiles → versioned writes). OneDrive cloud sync is a known risk;
local data directory is the recommended default.

---

## Document Index

| # | Document | What It Covers |
|---|----------|---------------|
| 01 | [Project Overview & Vision](01-PROJECT-OVERVIEW.md) | Goals, success criteria, feature inventory, out-of-scope |
| 02 | [Current Architecture Analysis](02-CURRENT-ARCHITECTURE.md) | Backend, frontend, data model, services, tests, reusability assessment |
| 03 | [VS Code Extension Architecture](03-VSCODE-EXTENSION-ARCHITECTURE.md) | Target structure, module descriptions, technology stack, package.json manifest |
| 04 | [Shared Backend & Multi-Instance Strategy](04-BACKEND-STRATEGY.md) | Data directory, concurrency levels, atomic writes, file watchers, Python coexistence |
| 05 | [UI/UX Mapping](05-UI-UX-MAPPING.md) | Feature-by-feature web→VS Code translation, sidebar layout, webview design, comparison matrix |
| 06 | [Migration & Implementation Plan](06-MIGRATION-PLAN.md) | 4-phase roadmap, task breakdown, porting effort, risk table, timeline |
| 07 | [Testing & CI Strategy](07-TESTING-AND-CI.md) | Unit/integration/E2E tests, CI pipeline, quality gates, test porting guide |
| 08 | [Use Cases & User Stories](08-USE-CASES.md) | 16 detailed use cases, user stories per phase, acceptance test plan |
| 09 | [Known Problems & Solutions](09-PROBLEMS-AND-SOLUTIONS.md) | 14 problems with solutions, edge cases checklist |

---

## Quick Reference

### Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Server dependency | **None** — direct file I/O | Simpler setup, no Python runtime needed |
| Data directory | User-space (`~/.arbeitsplatz`) | Shared across all VS Code windows |
| Concurrency | Lockfiles (`proper-lockfile`) | Safe multi-instance without schema changes |
| UI framework (webviews) | Vanilla TS + VS Code Webview UI Toolkit | Small bundle, theme-native |
| Build tool | esbuild | Fast, recommended by VS Code team |
| Test framework | Vitest (unit) + @vscode/test-electron (E2E) | Fast unit tests, real integration |

### Porting Summary (Python → TypeScript)

| Module | Lines | Status |
|--------|-------|--------|
| `json_store.py` → `json-store.ts` | 30 → 60 | Ready to port |
| `time_utils.py` → `time-utils.ts` | 50 → 60 | Ready to port |
| `link_tree.py` → `link-tree.ts` | 45 → 50 | Ready to port |
| `tag_propagation.py` → `tag-propagation.ts` | 120 → 140 | Ready to port |
| `recurring_generation.py` → `recurring-sync.ts` | 150 → 170 | Ready to port |
| `todo_page.py` → `todo-page.ts` | 25 → 30 | Optional |
| Models (8 files) → TS interfaces | 200 → 150 | Ready to port |

### Phase Timeline

```
Phase 0 — Scaffold & Tooling ................. 2 days
Phase 1 — Core Data + TODOs .................. 5 days  ← First usable version
Phase 2 — All Modules ........................ 7 days  ← Feature parity
Phase 3 — Webviews + Polish .................. 5 days  ← Production quality
Phase 4 — Multi-Instance + Publish ........... 4 days  ← Marketplace ready
```

### Extension-Exclusive Features (Not in Web App)

- **Run in Terminal**: Execute saved commands directly in VS Code's integrated terminal
- **Paste to Terminal**: Send snippet text to the active terminal
- **Status Bar Counters**: Always-visible todo count and daily hours
- **Command Palette Integration**: Every action accessible via Ctrl+Shift+P
- **Keyboard Shortcuts**: Ctrl+Shift+T (add todo), Ctrl+Shift+C (add command), Ctrl+Shift+D (dashboard)
- **File Watcher Sync**: Cross-instance real-time data synchronization

---

## How to Use These Documents

1. **Starting the project?** → Read [01-PROJECT-OVERVIEW.md](01-PROJECT-OVERVIEW.md) for the big picture.
2. **Understanding the existing code?** → Read [02-CURRENT-ARCHITECTURE.md](02-CURRENT-ARCHITECTURE.md).
3. **Designing the extension?** → Read [03-VSCODE-EXTENSION-ARCHITECTURE.md](03-VSCODE-EXTENSION-ARCHITECTURE.md) and [05-UI-UX-MAPPING.md](05-UI-UX-MAPPING.md).
4. **Planning the data layer?** → Read [04-BACKEND-STRATEGY.md](04-BACKEND-STRATEGY.md).
5. **Writing the first code?** → Follow Phase 0 tasks in [06-MIGRATION-PLAN.md](06-MIGRATION-PLAN.md).
6. **Setting up tests?** → Read [07-TESTING-AND-CI.md](07-TESTING-AND-CI.md).
7. **Implementing features?** → Use [08-USE-CASES.md](08-USE-CASES.md) as a checklist.
8. **Running into issues?** → Check [09-PROBLEMS-AND-SOLUTIONS.md](09-PROBLEMS-AND-SOLUTIONS.md).

---

*This project will be a success. Let's build it!* 🚀

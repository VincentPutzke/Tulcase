# Release Plan v1.3.7

Patch release of the Tulcase VS Code extension from `develop` → `main`.

## Goals
- Ship `tulcase` v1.3.7 with records calendar layout fixes
- Tests pass, webview assets compiled
- Extension packaged as `.vsix`

## Changes in this release
- **Portrait mode**: calendar height capped with `min()` so all 42 days always visible
- **Landscape mode**: cal-pane width derived from container height for square cells; entries-pane fills remaining space with `1fr`
- **Wide controls pane**: consistent `gap: 10px` below add-bar buttons across all views

## Checklist

### 1. Code & Metadata
- [x] Merge `feature/calendar-fit` → `develop`
- [x] Bump `version` in `package.json` to `1.3.7`
- [x] Commit version bump to `develop`

### 2. Tests & Quality
- [x] Run unit tests: `npm test` — 131/131 passed
- [x] Build: `npm run compile` — clean

### 3. Build & Package
- [x] Package: `vsce package` → `vscode-tulcase-1.3.7.vsix` (70.35 KB, 21 files)

### 4. Finalize Release
- [x] Merge `develop` → `main` (`git checkout main && git merge --no-ff develop`)
- [x] Tag: `git tag v1.3.7` on `main`

## Commands

```bash
# Build & test
npm run compile
npm test
# Package
vsce package
# Merge & tag
git checkout main
git merge --no-ff develop
git tag v1.3.7
```

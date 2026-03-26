# Release Plan v1.0.0

First production release of the Tulcase VS Code extension from `develop` → `main`.

## Goals
- Ship `tulcase` v1.0.0 as a clean, standalone extension (no `arbeitsplatz` legacy fallback)
- Tests and linter pass, webview assets compiled
- Extension packaged as `.vsix` and ready for marketplace / local install

## Checklist

### 1. Code & Metadata
- [x] Remove `arbeitsplatz` migration fallback from `src/config.ts`
- [x] Bump `version` in `package.json` to `1.0.0`
- [x] Confirm `CHANGELOG.md` has a `1.0.0` entry
- [x] Verify `package.json` fields: `name`, `displayName`, `publisher`, repository URL

### 2. Tests & Quality
- [x] Run unit tests: `npm test`
- [x] Run linter: `npm run lint`
- [x] Manual smoke test: install from `.vsix`, verify TODOs / Records / Tags / Commands / Links / Notes all work

### 3. Build & Package
- [x] Build: `npm run compile`
- [x] Package: `vsce package` → generates `vscode-tulcase-1.0.0.vsix`

### 4. Finalize Release
- [x] Merge `develop` → `main` (`git checkout main && git merge --no-ff develop`)
- [x] Tag: `git tag -a v1.0.0 -m "v1.0.0"` and `git push origin main --tags`
- [x] Publish to Marketplace (optional): `vsce publish`

## Commands

```bash
# Build & test
npm run compile
npm test
npm run lint
# Package
vsce package
# Merge & tag
git checkout main
git merge --no-ff develop
git tag -a v1.0.0 -m "v1.0.0"
git push origin main --tags
# Publish (requires PAT)
vsce publish
```

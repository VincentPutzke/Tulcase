# Releasing Tulcase

Tulcase now includes GitHub Actions automation for CI and release publishing.

## Workflows

### CI

The CI workflow runs on pushes and pull requests.

It performs two stages:

1. `Test` — installs dependencies and runs `npm test`
2. `Build` — installs dependencies and runs `npm run compile`

### Release VSIX

The release workflow is triggered manually from GitHub Actions and runs entirely on GitHub.

It always releases from `main`, so the normal flow is:

1. merge the tested branch into `main`
2. open the release workflow in GitHub Actions
3. choose the semantic bump
4. let GitHub create the commit, tag, release, and `.vsix` asset upstream

It performs three stages:

1. `Test`
2. `Build`
3. `Release`

## What the Release Workflow Does

When you start the release workflow, it will:

1. check out `main`
2. run tests
3. build the extension
4. bump the version automatically using the selected semantic bump type
5. package the `.vsix`
6. commit the version bump back to `main`
7. create a Git tag like `v1.3.13`
8. create a GitHub Release
9. upload the `.vsix` as a release asset

That means the final release is directly downloadable from GitHub.

## How to Use It

In GitHub:

1. open the repository
2. go to `Actions`
3. open `Release VSIX`
4. click `Run workflow`
5. choose `patch`, `minor`, or `major`
6. run the workflow

## Result

After a successful run, GitHub will contain:

- an updated `main` commit with the new version
- a release tag
- a published GitHub Release
- a downloadable `.vsix` asset

## Why This Is Manual-Dispatch Instead of Every Push

This keeps releases intentional.

Every push should be validated automatically, but not every push should become a public release.

This is the safer default for a developer tool.
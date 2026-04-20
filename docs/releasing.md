# Releasing Tulcase

Tulcase now includes GitHub Actions automation for CI and release publishing.

## Workflows

### CI

The CI workflow runs on pushes and pull requests.

It performs two stages:

1. `Test` — installs dependencies and runs `npm test`
2. `Build` — installs dependencies and runs `npm run compile`

### Sync Version

The version sync workflow runs on pushes to `feature/*`, `fix/*`, `hotfix/*`, `develop`, and `main`.

It applies the branch rules automatically:

1. feature-like branches get prereleases such as `1.4.1-recordfix-0`
2. `develop` bumps the patch line, e.g. `1.4.1` → `1.4.2`
3. `main` bumps the minor line, e.g. `1.4.2` → `1.5.0`

If the computed version differs, the workflow commits the updated `package.json` and `package-lock.json` back to the branch with `[skip ci]`.

### Release VSIX

The release workflow is triggered manually from GitHub Actions and runs entirely on GitHub.

It always releases from `main`, so the normal flow is:

1. merge the tested branch into `develop`
2. let the version sync workflow commit the patch bump automatically
3. merge `develop` into `main`
4. let the version sync workflow commit the minor bump automatically
5. open the release workflow in GitHub Actions
6. publish the current version, or choose a manual `major` bump if needed

It performs three stages:

1. `Test`
2. `Build`
3. `Release`

## What the Release Workflow Does

When you start the release workflow, it will:

1. check out `main`
2. run tests
3. build the extension
4. optionally perform a manual `major` bump
5. package the `.vsix`
6. create a Git tag like `v1.4.1`
7. create a GitHub Release
8. upload the `.vsix` as a release asset

That means the final release is directly downloadable from GitHub.

## How to Use It

In GitHub:

1. open the repository
2. go to `Actions`
3. open `Release VSIX`
4. click `Run workflow`
5. choose `none` for a normal release, or `major` for a manual major bump
6. run the workflow

## Result

After a successful run, GitHub will contain:

- an updated `main` version commit from the sync workflow, if one was needed
- a release tag
- a published GitHub Release
- a downloadable `.vsix` asset

## Why This Is Manual-Dispatch Instead of Every Push

This keeps releases intentional.

Every push should be validated automatically, but not every push should become a public release.

This is the safer default for a developer tool.
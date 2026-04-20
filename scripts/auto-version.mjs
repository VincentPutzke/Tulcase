import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const shouldWrite = process.argv.includes('--write');

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function getBranchName() {
  return process.env.GITHUB_REF_NAME || runGit(['branch', '--show-current']);
}

function stripPrerelease(version) {
  return version.split('-')[0];
}

function parseVersion(version) {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(stripPrerelease(version));
  if (!match) {
    throw new Error(`Unsupported semver version: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function bumpPatch(version) {
  return formatVersion({
    ...parseVersion(version),
    patch: parseVersion(version).patch + 1,
  });
}

function bumpMinor(version) {
  const parsed = parseVersion(version);
  return `${parsed.major}.${parsed.minor + 1}.0`;
}

function sanitizeBranch(branchName) {
  const shortName = branchName
    .replace(/^refs\/heads\//, '')
    .replace(/^(feature|fix|hotfix|bugfix|chore|refactor)\//i, '');

  const slug = shortName.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  return slug || 'branch';
}

function resolveFeatureBaseRef() {
  const candidates = [];

  if (process.env.GITHUB_BASE_REF) {
    candidates.push(`origin/${process.env.GITHUB_BASE_REF}`);
  }

  candidates.push('origin/develop');
  candidates.push('develop');

  for (const candidate of candidates) {
    try {
      return runGit(['merge-base', 'HEAD', candidate]);
    } catch {
      // Try the next candidate.
    }
  }

  return runGit(['rev-list', '--max-parents=0', 'HEAD']).split('\n')[0];
}

function countMeaningfulCommits(baseRef) {
  const output = runGit(['log', '--format=%s', '--no-merges', `${baseRef}..HEAD`]);
  if (!output) {
    return 0;
  }

  return output
    .split('\n')
    .filter(Boolean)
    .filter((message) => !/^\[skip ci\] chore: version /i.test(message))
    .length;
}

function computeVersion() {
  const branchName = getBranchName();
  const currentVersion = stripPrerelease(readJson('package.json').version);

  if (branchName === 'main') {
    return bumpMinor(currentVersion);
  }

  if (branchName === 'develop') {
    return bumpPatch(currentVersion);
  }

  const baseRef = resolveFeatureBaseRef();
  const meaningfulCommits = countMeaningfulCommits(baseRef);
  const prereleaseNumber = Math.max(0, meaningfulCommits - 1);
  return `${currentVersion}-${sanitizeBranch(branchName)}-${prereleaseNumber}`;
}

function syncVersion(version) {
  const packageJson = readJson('package.json');
  packageJson.version = version;
  writeJson('package.json', packageJson);

  const packageLock = readJson('package-lock.json');
  packageLock.version = version;

  if (packageLock.packages && packageLock.packages['']) {
    packageLock.packages[''].version = version;
  }

  writeJson('package-lock.json', packageLock);
}

try {
  const version = computeVersion();

  if (shouldWrite) {
    syncVersion(version);
  }

  process.stdout.write(`${version}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
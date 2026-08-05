#!/usr/bin/env node
// Create the GitHub release for a cohort version that was already published to
// npm but never got its change record.
//
// The `publish-change-record` job in publish-bleedingdev.yml is correct, but it
// cannot recover on a partial re-run: `gh run rerun --failed` re-runs FAILED
// jobs, and a job that was SKIPPED (because its `needs` had not completed on
// the first attempt) never re-enters the graph. A full re-dispatch is not an
// option either -- the publish job runs first and would refuse an already
// published version. So recovery happens here, out of band.
//
// This deliberately stays a local script rather than a second workflow:
// validate-publish-security.mjs vets only the three named workflow files, so a
// new CI job holding `contents: write` would be an unvetted write path.
//
// Usage:
//   node scripts/ultramodern-publish/backfill-change-record.mjs \
//     --version 3.5.0-ultramodern.100 --commit <sha> [--repo owner/name] [--dry-run]

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RELEASE_TAG_PREFIX } from './gen-cohort-change-record.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

// Returns '' when stdout is inherited rather than captured -- execFileSync
// yields null in that case.
const run = (file, args, options = {}) =>
  execFileSync(file, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  })?.trim() ?? '';

function parseArgs(argv) {
  const parsed = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--version') {
      parsed.version = argv[++index];
    } else if (arg === '--commit') {
      parsed.commit = argv[++index];
    } else if (arg === '--repo') {
      parsed.repo = argv[++index];
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!parsed.version) {
    throw new Error('--version is required');
  }
  if (!parsed.commit) {
    throw new Error(
      '--commit is required (the commit the version published from)',
    );
  }
  return parsed;
}

function existingLocalTagCommit(tag) {
  try {
    return (
      run('git', [
        'rev-parse',
        '-q',
        '--verify',
        `refs/tags/${tag}^{commit}`,
      ]) || null
    );
  } catch {
    return null;
  }
}

// Returns the commit a remote tag points at, null when the tag is absent, or
// undefined when the remote could not be reached (so the caller can fall back).
function existingRemoteTagCommit(tag, repo) {
  const url = repo ? `https://github.com/${repo}.git` : 'origin';
  let output;
  try {
    output = run('git', [
      'ls-remote',
      '--tags',
      url,
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]);
  } catch {
    return undefined;
  }
  const lines = output.split('\n').filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  // An annotated tag reports both the tag object and, via `^{}`, the commit it
  // dereferences to. Prefer the dereferenced line.
  const dereferenced = lines.find(line => line.endsWith('^{}'));
  return (dereferenced ?? lines[0]).split(/\s+/u)[0];
}

function main() {
  const { version, commit, repo, dryRun } = parseArgs(process.argv.slice(2));
  const tag = `${RELEASE_TAG_PREFIX}${version}`;

  // Resolve to a full sha and prove the commit is reachable, so the release
  // never points at something that was never pushed.
  const sha = run('git', ['rev-parse', `${commit}^{commit}`]);
  const remoteBranches = run('git', ['branch', '-r', '--contains', sha]);
  if (!remoteBranches) {
    throw new Error(`commit ${sha} is not on any remote branch; push it first`);
  }

  // Same guard as the workflow: this fork carries hundreds of inherited
  // upstream tags, and `gh release create` silently reuses an existing tag and
  // ignores --target. Never move one.
  //
  // Check the REMOTE, not just local refs. The workflow checks out with
  // fetch-depth 0 so it always has the tags; a working copy usually has not
  // fetched a tag that a previous release created, which would let this walk
  // straight past the guard.
  const existing =
    existingRemoteTagCommit(tag, repo) ?? existingLocalTagCommit(tag);
  if (existing && existing !== sha) {
    throw new Error(`tag ${tag} already exists at ${existing}, not ${sha}`);
  }

  // gen-cohort-change-record.mjs scopes the record to changes since the most
  // recent LOCAL `ultramodern-v*` tag. The workflow checks out with fetch-depth 0
  // so it always has them; a working copy may not, which would silently widen the
  // record back to the full backlog. Non-fatal: offline still produces a record,
  // just a broader one.
  try {
    run(
      'git',
      ['fetch', '--tags', repo ? `https://github.com/${repo}.git` : 'origin'],
      {
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    );
  } catch {
    console.warn(
      'warning: could not fetch tags; since-boundary may be too wide',
    );
  }

  const outDir = mkdtempSync(path.join(tmpdir(), 'ultramodern-change-record-'));
  const recordPath = path.join(outDir, 'change-record.md');

  run(
    'node',
    [
      'scripts/ultramodern-publish/gen-cohort-change-record.mjs',
      '--version',
      version,
      '--out',
      recordPath,
    ],
    {
      env: {
        ...process.env,
        GITHUB_SHA: sha,
        GITHUB_REPOSITORY: repo ?? process.env.GITHUB_REPOSITORY ?? '',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );

  const releaseArgs = [
    'release',
    'create',
    tag,
    '--target',
    sha,
    '--title',
    `@bleedingdev/modern-js-* ${version}`,
    '--notes-file',
    recordPath,
  ];
  if (repo) {
    releaseArgs.push('--repo', repo);
  }

  if (dryRun) {
    console.log(`[dry-run] change record written to ${recordPath}`);
    console.log(`[dry-run] would run: gh ${releaseArgs.join(' ')}`);
    return;
  }

  console.log(run('gh', releaseArgs));
}

main();

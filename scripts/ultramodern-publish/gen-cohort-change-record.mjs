#!/usr/bin/env node
// Aggregate queued .changeset/*.md into ONE cohort change record for the
// @bleedingdev/modern-js-* channel. Read-only: never mutates package.json,
// never consumes changesets, never runs `changeset version`.
//
// FORK: this script has no upstream counterpart. Upstream Modern.js publishes
// per-package CHANGELOG.md through `changeset version`, which this fork must
// not run in the release path (it would bump the whole fixed `@modern-js/*`
// group at major and consume every queued changeset).
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Fork-owned commit identities. Everything else is inherited upstream work.
const FORK_AUTHORS = new Set([
  'syreanis+1@gmail.com',
  'syreanis@gmail.com',
  'debug@ultramodern.local',
]);

const classify = summary =>
  /^feat/i.test(summary)
    ? 'Features'
    : /^(fix|hotfix)/i.test(summary)
      ? 'Bug Fixes'
      : /^perf/i.test(summary)
        ? 'Performance'
        : /^docs/i.test(summary)
          ? 'Docs'
          : /^(chore|build|refactor|test)/i.test(summary)
            ? 'Internal'
            : 'Other';

const TYPE_ORDER = [
  'Features',
  'Bug Fixes',
  'Performance',
  'Docs',
  'Internal',
  'Other',
];

// A Chinese translation follows the English summary in this repo, either as a
// separate paragraph or as the very next line.
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;

// Repo convention: the first paragraph of the body is the English summary and
// the next paragraph (or line) is its Chinese translation. Long English
// summaries are hard-wrapped, so the whole first paragraph is joined rather
// than only its first line, then cut at the first translated line.
export function extractSummary(body) {
  const lines = body.split('\n').map(line => line.trimEnd());
  const start = lines.findIndex(Boolean);
  if (start === -1) {
    return '';
  }
  const paragraph = [];
  for (let index = start; index < lines.length && lines[index]; index += 1) {
    paragraph.push(lines[index].trim());
  }
  const translated = paragraph.findIndex(line => CJK.test(line));
  // translated === 0 means the changeset is Chinese-only; keep it verbatim.
  const english = translated > 0 ? paragraph.slice(0, translated) : paragraph;
  return english.join(' ').replace(/\s+/g, ' ').trim();
}

// FORK: the release tag namespace. Upstream Modern.js owns `v*` in this
// repository (271 inherited tags, v1.x .. v3.4.0), so fork releases MUST NOT
// use it — `gh release create` reuses a pre-existing tag and ignores --target.
// Keep in sync with .github/workflows/publish-bleedingdev.yml.
export const RELEASE_TAG_PREFIX = 'ultramodern-v';

// GitHub rejects a release body over 125,000 characters. Fail well before that,
// and fail in the GENERATOR (which runs before `gh release create`) rather than
// in the release step, which executes after npm publish is already irreversible.
export const MAX_RELEASE_BODY_CHARS = 120_000;

const git = (args, rootDir) => {
  try {
    return execFileSync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

// `git merge-base --is-ancestor` signals through the exit code, not stdout.
const isAncestor = (candidate, descendant, rootDir) => {
  try {
    execFileSync(
      'git',
      ['merge-base', '--is-ancestor', candidate, descendant],
      {
        cwd: rootDir,
        stdio: 'ignore',
      },
    );
    return true;
  } catch {
    return false;
  }
};

const resolvePreviousRelease = (rootDir, options = {}) => {
  const targetTag = options.targetVersion
    ? `${RELEASE_TAG_PREFIX}${options.targetVersion}`
    : '';
  const tags = git(
    [
      'tag',
      '--list',
      `${RELEASE_TAG_PREFIX}*`,
      '--sort=-creatordate',
      '--format=%(refname:strip=2)',
    ],
    rootDir,
  )
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  for (const tag of tags) {
    // A trusted-publishing rerun may begin after the release step already
    // created the target tag. It is never the "previous" boundary.
    if (tag === targetTag) {
      continue;
    }
    const commit = git(['rev-parse', `${tag}^{commit}`], rootDir);
    if (
      !commit ||
      (options.targetCommit &&
        !isAncestor(commit, options.targetCommit, rootDir))
    ) {
      continue;
    }
    return {
      commit,
      tag,
      version: tag.slice(RELEASE_TAG_PREFIX.length),
    };
  }
  return { commit: '', tag: '', version: '' };
};

/**
 * The commit of the most recent fork release, used as the "since" boundary.
 * Returns '' on the first release (no fork tag yet), which includes the whole
 * queued backlog by design.
 */
export function resolvePreviousReleaseCommit(rootDir = repoRoot, options = {}) {
  return resolvePreviousRelease(rootDir, options).commit;
}

export async function collectChangesetEntries(
  rootDir = repoRoot,
  options = {},
) {
  const dir = path.join(rootDir, '.changeset');
  const files = (await readdir(dir)).filter(
    file => file.endsWith('.md') && file.toLowerCase() !== 'readme.md',
  );
  // Changesets are deliberately never consumed in this fork (`changeset
  // version` is banned in the release path — it would bump the whole fixed
  // @modern-js/* group at major). Without a boundary every release would
  // republish the entire fork history, so scope to changesets ADDED after the
  // previous fork release.
  const since =
    options.since === undefined
      ? resolvePreviousReleaseCommit(rootDir, {
          targetCommit: options.targetCommit,
          targetVersion: options.targetVersion,
        })
      : options.since;
  const entries = [];
  for (const file of files.sort()) {
    const raw = await readFile(path.join(dir, file), 'utf8');
    const parsed = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!parsed) {
      continue;
    }
    const packages = [
      ...parsed[1].matchAll(/['"]([^'"]+)['"]\s*:\s*(major|minor|patch)/g),
    ].map(([, name, bump]) => ({ name, bump }));
    const summary = extractSummary(parsed[2]);
    let sha = '';
    let email = '';
    try {
      [sha = '', email = ''] = execFileSync(
        'git',
        [
          'log',
          '--diff-filter=A',
          '-1',
          '--format=%h|%ae',
          '--',
          `.changeset/${file}`,
        ],
        { cwd: rootDir, encoding: 'utf8' },
      )
        .trim()
        .split('|');
    } catch {
      // A changeset added in the working tree has no add-commit yet.
    }
    // Already reachable from the previous release => already published.
    if (since && sha && isAncestor(sha, since, rootDir)) {
      continue;
    }
    entries.push({
      id: file.replace(/\.md$/, ''),
      packages,
      summary,
      sha,
      // An entry with no add-commit exists only in this working tree, so it is
      // fork-authored by construction; it cannot have been inherited.
      fork: email === '' ? true : FORK_AUTHORS.has(email),
      type: classify(summary),
    });
  }
  return entries;
}

const renderNames = entry =>
  entry.packages
    .map(pkg => pkg.name.replace(/^@modern-js\//, '@bleedingdev/modern-js-'))
    .join(', ');

const entryBump = entry =>
  entry.packages.some(pkg => pkg.bump === 'major')
    ? 'major'
    : entry.packages.some(pkg => pkg.bump === 'minor')
      ? 'minor'
      : 'patch';

const renderEntry = entry =>
  `- **${entryBump(entry)}** ${entry.summary} (${renderNames(entry)})${
    entry.sha ? ` [\`${entry.sha}\`]` : ''
  }\n`;

export function renderCohortChangeRecord(
  entries,
  { version, commit, repository, previousVersion },
) {
  const highest = entries.some(entry => entryBump(entry) === 'major')
    ? 'major'
    : entries.some(entry => entryBump(entry) === 'minor')
      ? 'minor'
      : 'patch';
  const fork = entries.filter(entry => entry.fork);
  const upstream = entries.filter(entry => !entry.fork);
  // A `major` changeset is a consumer-visible break shipped under a dist-tag
  // consumers read as ordinary. Hoist it, never leave it buried in a bucket.
  const breaking = entries.filter(entry => entryBump(entry) === 'major');

  let out = `# @bleedingdev/modern-js-* — ${version}\n\n`;
  out +=
    'Cohort release: every `@bleedingdev/modern-js-*` package publishes at this exact version.\n\n';
  out += `- Source commit: \`${commit ?? 'unknown'}\`${repository ? ` (${repository})` : ''}\n`;
  out += previousVersion
    ? `- Changes since: \`${previousVersion}\`\n`
    : '- Changes since: first UltraModern release (full queued backlog)\n';
  out += `- Change records: ${entries.length} (UltraModern ${fork.length} / inherited upstream ${upstream.length})\n`;
  out += `- Highest bump requested: ${highest}\n\n`;

  if (breaking.length > 0) {
    out += '## BREAKING CHANGES\n\n';
    for (const entry of breaking) {
      out += renderEntry(entry);
    }
    out += '\n';
  }

  for (const [heading, group] of [
    ['UltraModern changes', fork],
    ['Inherited from upstream Modern.js', upstream],
  ]) {
    if (group.length === 0) {
      continue;
    }
    out += `## ${heading}\n\n`;
    for (const type of TYPE_ORDER) {
      const bucket = group.filter(entry => entry.type === type);
      if (bucket.length === 0) {
        continue;
      }
      out += `### ${type}\n\n`;
      for (const entry of bucket) {
        out += renderEntry(entry);
      }
      out += '\n';
    }
  }
  return out;
}

function parseArgs(argv) {
  const options = { version: '', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--version') {
      options.version = argv[index + 1] ?? '';
    }
    if (argv[index] === '--out') {
      options.out = argv[index + 1] ?? '';
    }
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) {
    throw new Error(
      `--version must be a semver value, found "${options.version}"`,
    );
  }
  if (!options.out) {
    throw new Error('--out is required');
  }
  return options;
}

export function resolvePreviousReleaseVersion(
  rootDir = repoRoot,
  options = {},
) {
  return resolvePreviousRelease(rootDir, options).version;
}

export async function generateCohortChangeRecord({
  rootDir = repoRoot,
  version,
  out,
  commit,
  repository,
}) {
  const previousRelease = resolvePreviousRelease(rootDir, {
    targetCommit: commit,
    targetVersion: version,
  });
  const entries = await collectChangesetEntries(rootDir, {
    since: previousRelease.commit,
  });
  if (entries.length === 0) {
    throw new Error(
      'refusing to publish an empty change record: no queued changesets added since the previous UltraModern release',
    );
  }
  const body = renderCohortChangeRecord(entries, {
    version,
    commit,
    repository,
    previousVersion: previousRelease.version,
  });
  // Fail HERE, not in `gh release create`: that step runs after npm publish has
  // already succeeded and cannot be rolled back.
  if (body.length > MAX_RELEASE_BODY_CHARS) {
    throw new Error(
      `change record is ${body.length} characters, over the ${MAX_RELEASE_BODY_CHARS} limit ` +
        `(GitHub rejects release bodies above 125000); tag the previous release as ` +
        `${RELEASE_TAG_PREFIX}<version> so the since-boundary can scope this record`,
    );
  }
  await writeFile(path.resolve(out), body, 'utf8');
  return { body, entries, previousRelease };
}

async function main() {
  const { version, out } = parseArgs(process.argv.slice(2));
  const { body, entries } = await generateCohortChangeRecord({
    version,
    out,
    commit: process.env.GITHUB_SHA,
    repository: process.env.GITHUB_REPOSITORY,
  });
  console.log(
    `Wrote cohort change record for ${version} (${entries.length} entries, ${body.length} chars) to ${out}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

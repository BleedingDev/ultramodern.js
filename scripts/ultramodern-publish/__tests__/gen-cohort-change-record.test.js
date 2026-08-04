const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// The generator is ESM; every sibling test in this directory is CommonJS
// because `pnpm test:scripts` globs `__tests__/*.test.js`.
const loadGenerator = () =>
  import(
    pathToFileURL(path.join(__dirname, '..', 'gen-cohort-change-record.mjs'))
      .href
  );

test('splits fork changes from inherited upstream changes', async () => {
  const { renderCohortChangeRecord } = await loadGenerator();
  const body = renderCohortChangeRecord(
    [
      {
        id: 'a',
        packages: [{ name: '@modern-js/app-tools', bump: 'minor' }],
        summary: 'feat(app-tools): fork thing',
        sha: 'aaaaaaa',
        fork: true,
        type: 'Features',
      },
      {
        id: 'b',
        packages: [{ name: '@modern-js/runtime', bump: 'patch' }],
        summary: 'fix(runtime): upstream thing',
        sha: 'bbbbbbb',
        fork: false,
        type: 'Bug Fixes',
      },
    ],
    {
      version: '3.5.0-ultramodern.99',
      commit: 'deadbeef',
      repository: 'BleedingDev/ultramodern.js',
    },
  );
  assert.match(body, /# @bleedingdev\/modern-js-\* — 3\.5\.0-ultramodern\.99/);
  assert.match(
    body,
    /Change records: 2 \(UltraModern 1 \/ inherited upstream 1\)/,
  );
  assert.match(body, /## UltraModern changes/);
  assert.match(body, /## Inherited from upstream Modern\.js/);
  assert.match(body, /@bleedingdev\/modern-js-app-tools/);
  assert.doesNotMatch(body, /@modern-js\//);
});

test('hoists major entries into a BREAKING CHANGES section and labels every bump', async () => {
  const { renderCohortChangeRecord } = await loadGenerator();
  const body = renderCohortChangeRecord(
    [
      {
        id: 'a',
        packages: [{ name: '@modern-js/plugin-i18n', bump: 'major' }],
        summary: 'fix(plugin-i18n): make I18nInstance assignable',
        sha: 'aaaaaaa',
        fork: true,
        type: 'Bug Fixes',
      },
      {
        id: 'b',
        packages: [{ name: '@modern-js/runtime', bump: 'patch' }],
        summary: 'fix(runtime): ordinary thing',
        sha: 'bbbbbbb',
        fork: true,
        type: 'Bug Fixes',
      },
    ],
    { version: '3.5.0-ultramodern.1' },
  );
  const breakingIndex = body.indexOf('## BREAKING CHANGES');
  assert.ok(breakingIndex > -1, 'BREAKING CHANGES section is missing');
  assert.ok(breakingIndex < body.indexOf('## UltraModern changes'));
  assert.match(
    body,
    /## BREAKING CHANGES\n\n- \*\*major\*\* fix\(plugin-i18n\)/,
  );
  assert.match(body, /- \*\*patch\*\* fix\(runtime\): ordinary thing/);
});

test('omits the BREAKING CHANGES section when nothing is major', async () => {
  const { renderCohortChangeRecord } = await loadGenerator();
  const body = renderCohortChangeRecord(
    [
      {
        id: 'a',
        packages: [{ name: '@modern-js/runtime', bump: 'patch' }],
        summary: 'fix(runtime): thing',
        sha: '',
        fork: true,
        type: 'Bug Fixes',
      },
    ],
    { version: '3.5.0-ultramodern.1' },
  );
  assert.doesNotMatch(body, /BREAKING CHANGES/);
  assert.match(body, /Changes since: first UltraModern release/);
});

test('records the previous release version when one exists', async () => {
  const { renderCohortChangeRecord } = await loadGenerator();
  const body = renderCohortChangeRecord(
    [
      {
        id: 'a',
        packages: [{ name: '@modern-js/runtime', bump: 'patch' }],
        summary: 'fix(runtime): thing',
        sha: '',
        fork: true,
        type: 'Bug Fixes',
      },
    ],
    { version: '3.5.0-ultramodern.2', previousVersion: '3.5.0-ultramodern.1' },
  );
  assert.match(body, /Changes since: `3\.5\.0-ultramodern\.1`/);
});

test('excludes changesets already reachable from the previous release', async () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');

  const { collectChangesetEntries, resolvePreviousReleaseCommit } =
    await loadGenerator();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-record-'));
  const run = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  try {
    run('init', '-q', '-b', 'main');
    run('config', 'user.email', 'debug@ultramodern.local');
    run('config', 'user.name', 'UltraModern Debug');
    fs.mkdirSync(path.join(root, '.changeset'));

    fs.writeFileSync(
      path.join(root, '.changeset', 'released.md'),
      "---\n'@modern-js/runtime': patch\n---\n\nfix(runtime): already shipped\n",
    );
    run('add', '-A');
    run('commit', '-qm', 'released');
    run('tag', 'ultramodern-v3.5.0-ultramodern.1');

    fs.writeFileSync(
      path.join(root, '.changeset', 'new.md'),
      "---\n'@modern-js/runtime': patch\n---\n\nfix(runtime): brand new\n",
    );
    run('add', '-A');
    run('commit', '-qm', 'new');

    assert.notEqual(resolvePreviousReleaseCommit(root), '');
    const scoped = await collectChangesetEntries(root);
    assert.deepEqual(
      scoped.map(entry => entry.id),
      ['new'],
    );

    // First-release fallback: no boundary means the whole backlog ships.
    const all = await collectChangesetEntries(root, { since: '' });
    assert.deepEqual(all.map(entry => entry.id).sort(), ['new', 'released']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a rendered body over the GitHub release-notes limit', async () => {
  const { renderCohortChangeRecord, MAX_RELEASE_BODY_CHARS } =
    await loadGenerator();
  const entries = Array.from({ length: 2000 }, (_, index) => ({
    id: `e${index}`,
    packages: [{ name: '@modern-js/runtime', bump: 'patch' }],
    summary: `fix(runtime): ${'x'.repeat(120)} ${index}`,
    sha: 'abcdef0',
    fork: true,
    type: 'Bug Fixes',
  }));
  const body = renderCohortChangeRecord(entries, {
    version: '3.5.0-ultramodern.1',
  });
  assert.ok(
    body.length > MAX_RELEASE_BODY_CHARS,
    'fixture must exceed the guard so the guard is meaningful',
  );
});

test('no changeset body carries a Cloudflare email-protection artifact', async () => {
  const fs = require('node:fs');
  const dir = path.join(__dirname, '..', '..', '..', '.changeset');
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md') || file.toLowerCase() === 'readme.md') {
      continue;
    }
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(
      !raw.includes('[email protected]'),
      `${file} contains a scraped "[email protected]" placeholder; it would ship verbatim into the GitHub release notes`,
    );
  }
});

test('reports the highest requested bump', async () => {
  const { renderCohortChangeRecord } = await loadGenerator();
  const body = renderCohortChangeRecord(
    [
      {
        id: 'a',
        packages: [{ name: '@modern-js/utils', bump: 'major' }],
        summary: 'feat!: x',
        sha: '',
        fork: true,
        type: 'Features',
      },
    ],
    { version: '4.0.0-ultramodern.1' },
  );
  assert.match(body, /Highest bump requested: major/);
});

test('joins a hard-wrapped English summary and drops the translation', async () => {
  const { extractSummary } = await loadGenerator();
  const summary = extractSummary(
    '\nUpdate UltraModern to the latest compatible\ndependency cohort.\n\n将 UltraModern 更新到最新的兼容依赖组合。\n',
  );
  assert.equal(
    summary,
    'Update UltraModern to the latest compatible dependency cohort.',
  );
});

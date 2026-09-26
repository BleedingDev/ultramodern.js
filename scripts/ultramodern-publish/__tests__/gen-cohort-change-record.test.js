// Consumer: publish-bleedingdev.yml cohort GitHub release notes.
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { createGitFixture } = require('../../lib/git-fixture');
const repoRoot = path.resolve(__dirname, '../../..');

// The generator is ESM; every sibling test in this directory is CommonJS
// because `pnpm test:scripts` globs `__tests__/*.test.js`.
const loadGenerator = () =>
  import(
    pathToFileURL(path.join(__dirname, '..', 'gen-cohort-change-record.mjs'))
      .href
  );

test('CLI refuses caller-supplied release identity without a verified manifest', () => {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cohort-record-cli-'));
  const out = path.join(root, 'change-record.md');

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, '..', 'gen-cohort-change-record.mjs'),
        '--out',
        out,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REPOSITORY: 'BleedingDev/ultramodern.js',
          GITHUB_SHA: 'e'.repeat(40),
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--manifest is required/u);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generator derives the record from an isolated verified release checkout', async () => {
  const fs = require('node:fs');
  const [
    { createReleaseArtifacts },
    { createTemplateRequiredFiles },
    generator,
  ] = await Promise.all([
    import('../lib/prepare-bleedingdev-packages/release-artifacts.mjs'),
    import('../lib/prepare-bleedingdev-packages/constants.mjs'),
    loadGenerator(),
  ]);
  // A fork-owned author, so the record classifies the changeset as fork work.
  const fixture = createGitFixture({
    author: { email: 'debug@ultramodern.local', name: 'UltraModern Debug' },
    prefix: 'cohort-record-release-',
  });
  const root = fixture.repoDir;
  const run = (...args) => fixture.git(args);
  const version = '3.5.0-ultramodern.1';
  const aliases = {
    '@modern-js/ultramodern-create':
      '@bleedingdev/modern-js-ultramodern-create',
    '@modern-js/i18n-utils': '@bleedingdev/modern-js-i18n-utils',
  };
  const definitions = [
    {
      dependencies: {
        '@modern-js/i18n-utils': `npm:${aliases['@modern-js/i18n-utils']}@${version}`,
      },
      exports: {
        '.': './index.js',
        './ultramodern-workspace': './index.js',
        './ultramodern-workspace/codesmith': './index.js',
      },
      sourceName: '@modern-js/ultramodern-create',
      targetName: aliases['@modern-js/ultramodern-create'],
      ultramodern: { frameworkVersion: version },
    },
    {
      dependencies: {},
      exports: { '.': './index.js' },
      sourceName: '@modern-js/i18n-utils',
      targetName: aliases['@modern-js/i18n-utils'],
    },
  ];

  try {
    run('init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(root, '.changeset'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.changeset', 'queued.md'),
      "---\n'@modern-js/i18n-utils': patch\n---\n\nfeat(i18n-utils): isolated release fixture\n",
    );
    run('add', '-A');
    run('commit', '-qm', 'queue isolated release fixture');
    const sourceCommit = run('rev-parse', 'HEAD');

    const packages = definitions.map(definition => {
      const packageDir = path.join(
        root,
        'staged',
        definition.targetName.replaceAll('/', '__'),
      );
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(
        path.join(packageDir, 'package.json'),
        `${JSON.stringify({
          dependencies: definition.dependencies,
          exports: definition.exports,
          name: definition.targetName,
          publishConfig: {
            access: 'public',
            exports: definition.exports,
          },
          ultramodern: definition.ultramodern,
          version,
        })}\n`,
      );
      fs.writeFileSync(path.join(packageDir, 'index.js'), 'export {};\n');
      if (definition.sourceName === '@modern-js/ultramodern-create') {
        for (const relativePath of createTemplateRequiredFiles) {
          const filePath = path.join(packageDir, relativePath);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, 'fixture\n');
        }
      }
      return {
        packageDir: path.relative(repoRoot, packageDir),
        sourceName: definition.sourceName,
        targetName: definition.targetName,
        version,
      };
    });
    const releaseDir = path.join(root, 'release');
    createReleaseArtifacts({
      aliases,
      outDir: releaseDir,
      packages,
      source: {
        commit: sourceCommit,
        repository: 'BleedingDev/ultramodern.js',
      },
      tag: 'latest',
      tools: { node: process.version, npm: 'fixture', pnpm: 'fixture' },
      version,
    });
    const out = path.join(root, 'change-record.md');
    const release = JSON.parse(
      fs.readFileSync(path.join(releaseDir, 'manifest.json'), 'utf8'),
    );
    const { body, entries } = await generator.generateCohortChangeRecord({
      rootDir: root,
      out,
      release,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].fork, true);
    assert.match(body, /## UltraModern changes/u);
    assert.doesNotMatch(body, /## Inherited from upstream Modern\.js/u);
    assert.match(body, new RegExp(`— ${version.replaceAll('.', '\\.')}`));
    assert.ok(
      body.includes(
        `- Source commit: \`${sourceCommit}\` (BleedingDev/ultramodern.js)`,
      ),
    );
    assert.doesNotMatch(body, /Mallory|eeeeeeee/u);
    assert.equal(fs.readFileSync(out, 'utf8'), body);
  } finally {
    fixture.cleanup();
  }
});

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

test('excludes changesets already reachable from the previous release', async () => {
  const fs = require('node:fs');

  const { collectChangesetEntries, resolvePreviousReleaseCommit } =
    await loadGenerator();
  const fixture = createGitFixture({ prefix: 'cohort-record-' });
  const root = fixture.repoDir;
  const run = (...args) => fixture.git(args);
  try {
    run('init', '-q', '-b', 'main');
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
    fixture.cleanup();
  }
});

test('regenerates the same non-empty record after the target release tag exists', async () => {
  const fs = require('node:fs');

  const { generateCohortChangeRecord } = await loadGenerator();
  const fixture = createGitFixture({ prefix: 'cohort-record-rerun-' });
  const root = fixture.repoDir;
  const run = (...args) => fixture.git(args);
  try {
    run('init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(root, '.changeset'));

    fs.writeFileSync(
      path.join(root, '.changeset', 'released.md'),
      "---\n'@modern-js/runtime': patch\n---\n\nfix(runtime): already shipped\n",
    );
    run('add', '-A');
    run('commit', '-qm', 'released');
    run('tag', 'ultramodern-v3.5.0-ultramodern.1');

    fs.writeFileSync(
      path.join(root, '.changeset', 'target.md'),
      "---\n'@modern-js/runtime': patch\n---\n\nfix(runtime): target release\n",
    );
    run('add', '-A');
    run('commit', '-qm', 'target');
    const githubSha = run('rev-parse', 'HEAD');
    const version = '3.5.0-ultramodern.2';
    const firstOutput = path.join(root, 'first.md');
    const rerunOutput = path.join(root, 'rerun.md');

    await generateCohortChangeRecord({
      rootDir: root,
      version,
      out: firstOutput,
      commit: githubSha,
      repository: 'BleedingDev/ultramodern.js',
    });
    run('tag', `ultramodern-v${version}`, githubSha);
    await generateCohortChangeRecord({
      rootDir: root,
      version,
      out: rerunOutput,
      commit: githubSha,
      repository: 'BleedingDev/ultramodern.js',
    });

    const first = fs.readFileSync(firstOutput);
    const rerun = fs.readFileSync(rerunOutput);
    assert.ok(first.byteLength > 0);
    assert.deepEqual(rerun, first);
  } finally {
    fixture.cleanup();
  }
});

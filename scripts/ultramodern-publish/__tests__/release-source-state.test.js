// Consumer: publish-bleedingdev.yml clean-source qualification.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { createGitFixture } = require('../../lib/git-fixture');

const makeRepository = t => {
  const fixture = createGitFixture({ prefix: 'ultramodern-release-source-' });
  t.after(fixture.cleanup);
  fixture.git(['init', '--quiet']);
  fs.writeFileSync(path.join(fixture.repoDir, 'tracked.txt'), 'committed\n');
  fixture.git(['add', 'tracked.txt']);
  fixture.git(['commit', '--quiet', '-m', 'fixture']);
  return fixture;
};

test('release source accepts a clean committed worktree and ignored outputs', async t => {
  const { assertCleanCommittedSource } = await import(
    '../lib/release-source-state.mjs'
  );
  const { git, repoDir: root } = makeRepository(t);

  fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
  git(['add', '.gitignore']);
  git(['commit', '--quiet', '-m', 'ignore build outputs']);
  fs.mkdirSync(path.join(root, 'dist'));
  fs.writeFileSync(path.join(root, 'dist/artifact.js'), 'ignored\n');

  assert.doesNotThrow(() => assertCleanCommittedSource(root));
});

test('release source rejects tracked, staged, and untracked changes', async t => {
  const { assertCleanCommittedSource } = await import(
    '../lib/release-source-state.mjs'
  );

  for (const fixture of [
    {
      label: 'tracked modification',
      mutate(root) {
        fs.writeFileSync(path.join(root, 'tracked.txt'), 'modified\n');
      },
      expected: 'tracked.txt',
    },
    {
      label: 'staged deletion',
      mutate(root, git) {
        git(['rm', '--quiet', 'tracked.txt']);
      },
      expected: 'tracked.txt',
    },
    {
      label: 'untracked file',
      mutate(root) {
        fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n');
      },
      expected: 'untracked.txt',
    },
  ]) {
    await t.test(fixture.label, t => {
      const { git, repoDir: root } = makeRepository(t);
      fixture.mutate(root, git);

      assert.throws(
        () => assertCleanCommittedSource(root),
        error => {
          assert.match(error.message, /release source worktree is not clean/i);
          assert.match(error.message, new RegExp(fixture.expected));
          return true;
        },
      );
    });
  }
});

test('release source rejects a repository without a committed HEAD', async t => {
  const { assertCleanCommittedSource } = await import(
    '../lib/release-source-state.mjs'
  );
  const fixture = createGitFixture({
    prefix: 'ultramodern-release-source-unborn-',
  });
  t.after(fixture.cleanup);
  fixture.git(['init', '--quiet']);

  assert.throws(
    () => assertCleanCommittedSource(fixture.repoDir),
    /release source must be a Git repository with a committed HEAD/i,
  );
});

test('release source rejects a clean HEAD that changed during preparation', async t => {
  const { assertCleanCommittedSource } = await import(
    '../lib/release-source-state.mjs'
  );
  const { git, repoDir: root } = makeRepository(t);
  const expectedCommit = assertCleanCommittedSource(root);

  fs.writeFileSync(path.join(root, 'tracked.txt'), 'second commit\n');
  git(['add', 'tracked.txt']);
  git(['commit', '--quiet', '-m', 'advance source']);

  assert.throws(
    () => assertCleanCommittedSource(root, { expectedCommit }),
    /release source HEAD changed during artifact preparation/i,
  );
});

test('release source inspects its cwd even when a git hook exported GIT_DIR', t => {
  const { env, git, repoDir: root } = makeRepository(t);
  const head = git(['rev-parse', 'HEAD']);
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'lib', 'release-source-state.mjs'),
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const { assertCleanCommittedSource } = await import(${JSON.stringify(moduleUrl)});
process.stdout.write(assertCleanCommittedSource(${JSON.stringify(root)}));`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...env,
        GIT_DIR: path.join(root, 'missing-git-dir'),
        GIT_INDEX_FILE: path.join(root, 'missing-index'),
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, head);
});

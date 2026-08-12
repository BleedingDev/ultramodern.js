// Consumer: publish-bleedingdev.yml clean-source qualification.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const makeRepository = () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-release-source-'),
  );
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'release-test@example.com'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'committed\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  return root;
};

test('release source accepts a clean committed worktree and ignored outputs', async t => {
  const { assertCleanCommittedSource } = await import(
    '../lib/release-source-state.mjs'
  );
  const root = makeRepository();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));

  fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'ignore build outputs'], {
    cwd: root,
  });
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
      mutate(root) {
        execFileSync('git', ['rm', '--quiet', 'tracked.txt'], { cwd: root });
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
      const root = makeRepository();
      t.after(() => fs.rmSync(root, { force: true, recursive: true }));
      fixture.mutate(root);

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
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ultramodern-release-source-unborn-'),
  );
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  execFileSync('git', ['init', '--quiet'], { cwd: root });

  assert.throws(
    () => assertCleanCommittedSource(root),
    /release source must be a Git repository with a committed HEAD/i,
  );
});

test('release source rejects a clean HEAD that changed during preparation', async t => {
  const { assertCleanCommittedSource } = await import(
    '../lib/release-source-state.mjs'
  );
  const root = makeRepository();
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const expectedCommit = assertCleanCommittedSource(root);

  fs.writeFileSync(path.join(root, 'tracked.txt'), 'second commit\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync('git', ['commit', '--quiet', '-m', 'advance source'], {
    cwd: root,
  });

  assert.throws(
    () => assertCleanCommittedSource(root, { expectedCommit }),
    /release source HEAD changed during artifact preparation/i,
  );
});

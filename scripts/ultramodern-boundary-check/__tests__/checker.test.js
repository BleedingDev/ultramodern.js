const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  checkForkImportBoundary,
  createAllowlistSnapshot,
  writeAllowlist,
} = require('../checker');
const { createGitFixture } = require('../../lib/git-fixture');

const repoRoot = path.resolve(__dirname, '../../..');

const makeGitFixture = () => {
  const {
    cleanup,
    git,
    repoDir: rootDir,
  } = createGitFixture({
    prefix: 'modern-fork-boundary-',
  });
  git(['init', '--quiet']);

  const sourceDir = path.join(rootDir, 'packages/runtime/src');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.writeFileSync(
    path.join(sourceDir, 'index.ts'),
    'export const runtimeValue = "upstream";\n',
  );

  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'base']);

  return {
    baseRef: git(['rev-parse', 'HEAD']),
    cleanup,
    git,
    rootDir,
  };
};

const writeFixtureAllowlist = ({ rootDir, baseRef, violations = [] }) => {
  const allowlistPath = path.join(rootDir, 'allowlist.json');
  fs.writeFileSync(
    allowlistPath,
    `${JSON.stringify(
      createAllowlistSnapshot({ baseRef, violations }),
      null,
      2,
    )}\n`,
  );
  return allowlistPath;
};

test('detects a new fork-only import in an upstream-owned source file', () => {
  const { rootDir, baseRef, cleanup } = makeGitFixture();

  try {
    const allowlistPath = writeFixtureAllowlist({ rootDir, baseRef });
    fs.writeFileSync(
      path.join(rootDir, 'packages/runtime/src/index.ts'),
      [
        "import tanstackPlugin from '@modern-js/plugin-tanstack';",
        'export const runtimeValue = tanstackPlugin;',
        '',
      ].join('\n'),
    );

    const report = checkForkImportBoundary({
      rootDir,
      baseRef,
      allowlistPath,
    });

    assert.equal(report.ok, false);
    assert.equal(report.added.length, 1);
    assert.deepEqual(report.added[0], {
      file: 'packages/runtime/src/index.ts',
      markers: ['@modern-js/plugin-tanstack'],
      specifier: '@modern-js/plugin-tanstack',
    });
  } finally {
    cleanup();
  }
});

test('ignores package source files that did not exist at the merge-base', () => {
  const { rootDir, baseRef, cleanup, git } = makeGitFixture();

  try {
    const allowlistPath = writeFixtureAllowlist({ rootDir, baseRef });
    fs.writeFileSync(
      path.join(rootDir, 'packages/runtime/src/new-file.ts'),
      "import '@modern-js/plugin-tanstack';\n",
    );
    git(['add', '.']);

    const report = checkForkImportBoundary({
      rootDir,
      baseRef,
      allowlistPath,
    });

    assert.equal(report.ok, true);
    assert.equal(report.added.length, 0);
  } finally {
    cleanup();
  }
});

test('writeAllowlist cannot permit existing governed imports', () => {
  const { rootDir, baseRef, cleanup } = makeGitFixture();

  try {
    fs.writeFileSync(
      path.join(rootDir, 'packages/runtime/src/index.ts'),
      [
        "import { createRequest } from './create-request';",
        'export const runtimeValue = createRequest;',
        '',
      ].join('\n'),
    );

    const allowlistPath = path.join(rootDir, 'allowlist.json');
    const writeReport = writeAllowlist({ rootDir, baseRef, allowlistPath });
    const checkReport = checkForkImportBoundary({
      rootDir,
      baseRef,
      allowlistPath,
    });

    assert.equal(writeReport.violations.length, 1);
    assert.equal(checkReport.ok, false);
    assert.equal(checkReport.added.length, 0);
  } finally {
    cleanup();
  }
});

test('an unresolvable ownership base fails closed instead of reporting clean', () => {
  const { rootDir, baseRef, cleanup } = makeGitFixture();
  try {
    const allowlistPath = writeFixtureAllowlist({ rootDir, baseRef });
    assert.throws(
      () =>
        checkForkImportBoundary({
          rootDir,
          baseRef: 'missing-ref',
          allowlistPath,
        }),
      /ownership base.*does not resolve/,
    );
  } finally {
    cleanup();
  }
});

test('inherited Git repository redirection cannot empty the import scan', () => {
  const { rootDir, baseRef, cleanup } = makeGitFixture();
  const previous = process.env.GIT_DIR;
  try {
    const allowlistPath = writeFixtureAllowlist({ rootDir, baseRef });
    fs.writeFileSync(
      path.join(rootDir, 'packages/runtime/src/index.ts'),
      "import '@modern-js/plugin-tanstack';\n",
    );
    process.env.GIT_DIR = path.join(rootDir, 'missing-git-directory');
    assert.equal(
      checkForkImportBoundary({ rootDir, baseRef, allowlistPath })
        .currentViolations.length,
      1,
    );
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
    cleanup();
  }
});

test('import verification CLI rejects caller-narrowed scope', () => {
  const cli = path.join(
    repoRoot,
    'scripts/ultramodern-boundary-check/check-fork-import-boundary.js',
  );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [cli, '--mode', 'imports', '--pathspec', 'packages/runtime'],
        { cwd: repoRoot, stdio: 'pipe' },
      ),
    error => {
      assert.equal(error.status, 1);
      assert.match(
        error.stderr.toString(),
        /is not accepted in verification modes/,
      );
      return true;
    },
  );
});

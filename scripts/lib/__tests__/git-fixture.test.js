const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const gitFixturePath = path.join(__dirname, '..', 'git-fixture.js');

test('fixture git ignores a hostile global config and inherited repository redirection', t => {
  const hostileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostile-git-'));
  t.after(() => fs.rmSync(hostileDir, { force: true, recursive: true }));
  const hookMarker = path.join(hostileDir, 'hook-ran');
  const failingHook = `#!/bin/sh\n: > ${JSON.stringify(hookMarker)}\nexit 1\n`;
  for (const hooksDir of ['hooks', 'template/hooks']) {
    fs.mkdirSync(path.join(hostileDir, hooksDir), { recursive: true });
    fs.writeFileSync(path.join(hostileDir, hooksDir, 'pre-commit'), failingHook, {
      mode: 0o755,
    });
  }
  const hostileConfig = path.join(hostileDir, 'gitconfig');
  fs.writeFileSync(
    hostileConfig,
    [
      '[core]',
      `\thooksPath = ${JSON.stringify(path.join(hostileDir, 'hooks'))}`,
      '[commit]',
      '\tgpgsign = true',
      '[init]',
      `\ttemplateDir = ${JSON.stringify(path.join(hostileDir, 'template'))}`,
      '[user]',
      '\tuseConfigOnly = true',
      '',
    ].join('\n'),
  );

  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { createGitFixture } = require(${JSON.stringify(gitFixturePath)});
    const fixture = createGitFixture();
    try {
      fixture.git(['init', '--quiet']);
      fs.writeFileSync(path.join(fixture.repoDir, 'file.txt'), 'fixture\\n');
      fixture.git(['add', 'file.txt']);
      fixture.git(['commit', '--quiet', '-m', 'fixture']);
      process.stdout.write(
        fixture.git(['log', '-1', '--format=%an <%ae>|%cn <%ce>|%G?']),
      );
    } finally {
      fixture.cleanup();
    }
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: hostileConfig,
      GIT_DIR: path.join(hostileDir, 'missing-git-dir'),
      GIT_INDEX_FILE: path.join(hostileDir, 'missing-index'),
      GIT_OBJECT_DIRECTORY: path.join(hostileDir, 'missing-objects'),
      GIT_WORK_TREE: path.join(hostileDir, 'missing-work-tree'),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    'Git Fixture <git-fixture@example.test>|Git Fixture <git-fixture@example.test>|N',
  );
  assert.equal(fs.existsSync(hookMarker), false);
});

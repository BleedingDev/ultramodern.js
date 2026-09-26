/**
 * Test support: a throwaway git repository that ignores the caller's git
 * environment. The developer's global config (hooksPath, commit.gpgsign,
 * init.templateDir, user.useConfigOnly), the system config, and inherited
 * repository redirection (GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE,
 * GIT_OBJECT_DIRECTORY, ...) never reach fixture commands.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRepositoryGitEnv } = require('./process-kit');

const FIXTURE_IDENTITY = 'Git Fixture';
const FIXTURE_EMAIL = 'git-fixture@example.test';
const FIXTURE_DATE = '2026-01-01T00:00:00Z';

/**
 * @param {{ prefix?: string, globalConfig?: string }} [options]
 *   `globalConfig` is the complete global config the fixture's git sees;
 *   it defaults to empty.
 */
function createGitFixture({ prefix = 'git-fixture-', globalConfig = '' } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  // Outside repoDir so it never shows up as an untracked file.
  const globalConfigPath = path.join(tempDir, 'gitconfig');
  const repoDir = path.join(tempDir, 'repo');
  fs.writeFileSync(globalConfigPath, globalConfig);
  fs.mkdirSync(repoDir);

  const env = createRepositoryGitEnv({
    GIT_CONFIG_GLOBAL: globalConfigPath,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: FIXTURE_IDENTITY,
    GIT_AUTHOR_EMAIL: FIXTURE_EMAIL,
    GIT_AUTHOR_DATE: FIXTURE_DATE,
    GIT_COMMITTER_NAME: FIXTURE_IDENTITY,
    GIT_COMMITTER_EMAIL: FIXTURE_EMAIL,
    GIT_COMMITTER_DATE: FIXTURE_DATE,
  });

  /** Runs git in `cwd` (default repoDir); returns trimmed stdout, throws on failure. */
  const git = (args, { cwd = repoDir } = {}) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `git ${args.join(' ')} failed in ${cwd} (exit ${result.status}): ${result.stderr.trim()}`,
      );
    }
    return result.stdout.trim();
  };

  const cleanup = () => {
    fs.rmSync(tempDir, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 200,
    });
  };

  return { cleanup, env, git, globalConfigPath, repoDir, tempDir };
}

module.exports = { createGitFixture };

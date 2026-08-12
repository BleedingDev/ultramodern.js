// Consumer: publish-bleedingdev.yml build and staging source qualification.
import { spawnSync } from 'node:child_process';

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function formatDirtyEntries(output) {
  const entries = output.split('\0').filter(Boolean);
  const visible = entries.slice(0, 20).map(entry => JSON.stringify(entry));
  if (entries.length > visible.length) {
    visible.push(`... and ${entries.length - visible.length} more`);
  }
  return visible.join('\n');
}

function assertCleanCommittedSource(cwd, { expectedCommit } = {}) {
  const head = runGit(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (head.status !== 0) {
    throw new Error(
      'Release source must be a Git repository with a committed HEAD.',
    );
  }
  const commit = head.stdout.trim().toLowerCase();
  if (expectedCommit && commit !== expectedCommit) {
    throw new Error(
      `Release source HEAD changed during artifact preparation: expected ${expectedCommit}, found ${commit}.`,
    );
  }

  const status = runGit(cwd, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ]);
  if (status.status !== 0) {
    throw new Error(
      `Cannot verify release source worktree state: ${status.stderr.trim()}`,
    );
  }
  if (status.stdout !== '') {
    throw new Error(
      [
        'Release source worktree is not clean. Commit or remove every tracked and untracked change before building or preparing release artifacts.',
        'Ignored files are allowed.',
        formatDirtyEntries(status.stdout),
      ].join('\n'),
    );
  }
  return commit;
}

export { assertCleanCommittedSource };

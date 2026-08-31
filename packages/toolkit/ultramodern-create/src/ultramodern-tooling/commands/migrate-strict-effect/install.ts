import { spawnSync } from 'node:child_process';
import type { CommandContext } from '../context';

export function runPnpmLockfileRefresh(context: CommandContext) {
  const result = spawnSync(
    'pnpm',
    ['install', '--lockfile-only', '--ignore-scripts'],
    {
      cwd: context.workspaceRoot,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

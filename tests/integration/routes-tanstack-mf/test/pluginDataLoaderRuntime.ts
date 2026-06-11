import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../..');
const require = createRequire(__filename);
const {
  acquireWorkspaceDistWriteLock,
} = require('../../../utils/modernTestUtils.js');

export async function ensurePluginDataLoaderRuntimeBuilt() {
  const pluginDataLoaderDir = path.join(
    repoRoot,
    'packages/cli/plugin-data-loader',
  );
  const runtimeEntry = path.join(
    pluginDataLoaderDir,
    'dist/esm/runtime/index.mjs',
  );
  if (existsSync(runtimeEntry)) {
    return;
  }

  // The rebuild wipes plugin-data-loader's dist, which concurrently spawned
  // modern builds resolve through; take the workspace dist write lock so we
  // never rewrite it under a running fixture build.
  const releaseDistWriteLock = await acquireWorkspaceDistWriteLock();
  try {
    if (existsSync(runtimeEntry)) {
      return;
    }
    execFileSync('pnpm', ['--dir', pluginDataLoaderDir, 'run', 'build'], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } finally {
    await releaseDistWriteLock();
  }
}

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../..');

export function ensurePluginDataLoaderRuntimeBuilt() {
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

  execFileSync('pnpm', ['--dir', pluginDataLoaderDir, 'run', 'build'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

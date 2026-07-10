// W5 observed-graph spike — generate a scratch workspace OUTSIDE the repo.
// Run: pnpm exec tsx scripts/mv-observed-graph-spike/generate-ws.mts [outDir]
// Read-only toward the repo; only writes under the target dir (default $TMPDIR/mv-spike-ws).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../../packages/toolkit/create/src/ultramodern-workspace/index.ts';

const outDir =
  process.argv[2] ?? path.join(os.tmpdir(), 'mv-spike-ws', 'workspace');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(outDir), { recursive: true });

const modernVersion = '3.2.1';
const packageSource = {
  strategy: 'install' as const,
  modernPackageVersion: '3.2.0-ultramodern.108',
};

generateUltramodernWorkspace({
  targetDir: outDir,
  packageName: 'mv-spike',
  modernVersion,
  enableTailwind: true,
  packageSource,
});

for (const name of ['catalog', 'checkout', 'inventory']) {
  addUltramodernVertical({ workspaceRoot: outDir, name, modernVersion });
}

// eslint-disable-next-line no-console
console.log(outDir);

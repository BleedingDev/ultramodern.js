// MV consumption-graph — generate a scratch MicroVertical workspace OUTSIDE the
// repo, for the observed-graph tools to analyze. Read-only toward the repo;
// writes only under the target dir.
//
// Run via the repo's bundled tsx loader (the @modern-js/create build is broken
// by an unrelated workstream — see README "Oracle / generation"):
//   node <tsxCli> scripts/mv-consumption-graph/generate-ws.mts [outDir]
//
// Divergence from scripts/mv-observed-graph-spike/generate-ws.mts: a local
// source checkout now REJECTS an explicit `install` package source
// (write-workspace.ts guard). We use the `workspace` strategy, which the guard
// permits for source checkouts and which still writes the full topology.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../../packages/toolkit/create/src/ultramodern-workspace/index.ts';

const outDir =
  process.argv[2] ?? path.join(os.tmpdir(), 'mv-consumption-ws', 'workspace');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(outDir), { recursive: true });

const modernVersion = '3.2.1';

generateUltramodernWorkspace({
  targetDir: outDir,
  packageName: 'mv-graph',
  modernVersion,
  enableTailwind: true,
  packageSource: { strategy: 'workspace' },
});

for (const name of ['catalog', 'checkout', 'inventory']) {
  addUltramodernVertical({ workspaceRoot: outDir, name, modernVersion });
}

// eslint-disable-next-line no-console
console.log(outDir);

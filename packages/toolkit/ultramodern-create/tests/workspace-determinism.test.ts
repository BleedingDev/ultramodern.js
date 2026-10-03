import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

type FileTreeSnapshot = Map<string, Buffer>;

async function generateFixedWorkspace(workspaceDir: string) {
  await generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'deterministic-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'workspace',
    },
  });

  await addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
}

function collectFileTreeSnapshot(root: string) {
  const snapshot: FileTreeSnapshot = new Map();

  function walk(directory: string) {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((first, second) => first.name.localeCompare(second.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join('/');

      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile()) {
        snapshot.set(relativePath, fs.readFileSync(absolutePath));
      } else if (entry.isSymbolicLink()) {
        snapshot.set(relativePath, Buffer.from(fs.readlinkSync(absolutePath)));
      } else {
        snapshot.set(relativePath, Buffer.from(`unsupported:${entry.name}`));
      }
    }
  }

  walk(root);

  return snapshot;
}

function firstFileTreeDifference(
  first: FileTreeSnapshot,
  second: FileTreeSnapshot,
) {
  const firstPaths = [...first.keys()].sort();
  const secondPaths = [...second.keys()].sort();
  const pathCount = Math.max(firstPaths.length, secondPaths.length);

  for (let index = 0; index < pathCount; index++) {
    const firstPath = firstPaths[index];
    const secondPath = secondPaths[index];

    if (firstPath === undefined) {
      return `extra file only in second tree: ${secondPath}`;
    }

    if (secondPath === undefined) {
      return `missing file from second tree: ${firstPath}`;
    }

    if (firstPath !== secondPath) {
      return `file set differs at sorted index ${index}: first has ${firstPath}, second has ${secondPath}`;
    }
  }

  for (const relativePath of firstPaths) {
    const firstBytes = first.get(relativePath);
    const secondBytes = second.get(relativePath);

    if (!firstBytes || !secondBytes) {
      return `file set lookup failed for ${relativePath}`;
    }

    if (!firstBytes.equals(secondBytes)) {
      return `contents differ for ${relativePath}: ${firstBytes.length} bytes in first tree, ${secondBytes.length} bytes in second tree`;
    }
  }

  return undefined;
}

test('generates byte-identical workspaces for a fixed shell and MicroVertical spec', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-workspace-determinism-'),
  );

  try {
    const firstWorkspaceDir = path.join(tempRoot, 'first');
    const secondWorkspaceDir = path.join(tempRoot, 'second');

    await generateFixedWorkspace(firstWorkspaceDir);
    await generateFixedWorkspace(secondWorkspaceDir);

    const difference = firstFileTreeDifference(
      collectFileTreeSnapshot(firstWorkspaceDir),
      collectFileTreeSnapshot(secondWorkspaceDir),
    );

    assert.equal(difference, undefined, difference);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

// Restored: delivery-unit build markers were once seeded per process, so a
// marker stamped by the CLI never matched the one recomputed by a later
// process (the generated `pnpm check` validator asserts they agree).
test('the CLI stamps the same delivery-unit build marker as an in-process add', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-marker-cross-'));
  try {
    const inProcessDir = path.join(tempRoot, 'in-process');
    await generateFixedWorkspace(inProcessDir);

    const cliDir = path.join(tempRoot, 'cli');
    await generateUltramodernWorkspace({
      targetDir: cliDir,
      packageName: 'deterministic-workspace',
      modernVersion: '3.2.1',
      enableTailwind: true,
      packageSource: { strategy: 'workspace' },
    });
    const cli = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, '../dist/esm-node/index.js'),
        'catalog',
        '--vertical',
      ],
      { cwd: cliDir, encoding: 'utf8' },
    );
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);

    const markerOf = (root: string) =>
      JSON.parse(
        fs.readFileSync(
          path.join(root, 'verticals/catalog/shared/ultramodern-build.json'),
          'utf8',
        ),
      ).deliveryUnit.buildMarker;
    assert.equal(markerOf(cliDir), markerOf(inProcessDir));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

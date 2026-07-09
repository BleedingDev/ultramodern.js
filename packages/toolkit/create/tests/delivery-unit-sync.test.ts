import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { runSyncDeliveryUnit } from '../src/ultramodern-workspace/delivery-unit-sync';

const TARGET_FILES = [
  '.modernjs/ultramodern.json',
  'topology/reference-topology.json',
  'verticals/catalog/shared/ultramodern-build.json',
  'verticals/catalog/shared/ultramodern-build.ts',
];

function read(workspaceDir: string, relativePath: string) {
  return fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8');
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

function snapshotAllFiles(root: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') {
          continue;
        }
        walk(absolute);
      } else if (entry.isFile()) {
        files.set(
          path.relative(root, absolute).split(path.sep).join('/'),
          fs.readFileSync(absolute, 'utf-8'),
        );
      }
    }
  };
  walk(root);
  return files;
}

function scaffoldWorkspace(): { tempRoot: string; workspaceDir: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-du-sync-'));
  const workspaceDir = path.join(tempRoot, 'du-sync-workspace');
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'du-sync-workspace',
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'install',
      modernPackageVersion: '3.2.0-ultramodern.108',
    },
  });
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
  return { tempRoot, workspaceDir };
}

function stripDeliveryUnitIdentity(workspaceDir: string) {
  const compactPath = '.modernjs/ultramodern.json';
  const compact = JSON.parse(read(workspaceDir, compactPath));
  for (const app of compact.topology.apps) {
    delete app.deliveryUnit;
    if (app.backendFederation) {
      delete app.backendFederation.deliveryUnit;
      if (app.backendFederation.versionBoundary) {
        delete app.backendFederation.versionBoundary.identityRoot;
      }
    }
  }
  writeJson(workspaceDir, compactPath, compact);

  const topologyPath = 'topology/reference-topology.json';
  const topology = JSON.parse(read(workspaceDir, topologyPath));
  for (const vertical of topology.verticals) {
    delete vertical.deliveryUnit;
    if (vertical.backendFederation) {
      delete vertical.backendFederation.deliveryUnit;
      if (vertical.backendFederation.versionBoundary) {
        delete vertical.backendFederation.versionBoundary.identityRoot;
      }
    }
  }
  writeJson(workspaceDir, topologyPath, topology);

  // Simulate a legacy build module without the delivery-unit identity export.
  fs.writeFileSync(
    path.join(workspaceDir, 'verticals/catalog/shared/ultramodern-build.ts'),
    "export const ultramodernVerticalIdentity = { appId: 'catalog' } as const;\n",
  );
}

test('sync-delivery-unit backfills identity blocks matching the generator', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    // Capture the generator's semantic output (parsed, so the fixture's
    // oxfmt whitespace does not enter the comparison).
    const expectedCompact = JSON.parse(
      read(workspaceDir, '.modernjs/ultramodern.json'),
    );
    const expectedTopology = JSON.parse(
      read(workspaceDir, 'topology/reference-topology.json'),
    );

    stripDeliveryUnitIdentity(workspaceDir);
    // Sanity: stripping actually removed the identity.
    assert.ok(
      !JSON.parse(
        read(workspaceDir, '.modernjs/ultramodern.json'),
      ).topology.apps.some((app: any) => app.deliveryUnit),
      'precondition: stripped config has no deliveryUnit',
    );

    const status = runSyncDeliveryUnit([], {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    });
    assert.equal(status, 0);

    // JSON files must be semantically restored to the generator output.
    assert.deepEqual(
      JSON.parse(read(workspaceDir, '.modernjs/ultramodern.json')),
      expectedCompact,
      '.modernjs/ultramodern.json should match the generator semantics',
    );
    assert.deepEqual(
      JSON.parse(read(workspaceDir, 'topology/reference-topology.json')),
      expectedTopology,
      'reference-topology.json should match the generator semantics',
    );

    // The framework-owned build module must carry the delivery-unit identity.
    const buildArtifact = JSON.parse(
      read(workspaceDir, 'verticals/catalog/shared/ultramodern-build.json'),
    );
    assert.equal(
      buildArtifact.deliveryUnit.unitId,
      'du-sync-workspace/catalog',
    );
    assert.equal(
      buildArtifact.surfaces.ui.unitId,
      buildArtifact.deliveryUnit.unitId,
    );
    assert.equal(
      buildArtifact.surfaces.api.buildMarker,
      buildArtifact.deliveryUnit.buildMarker,
    );

    const build = read(
      workspaceDir,
      'verticals/catalog/shared/ultramodern-build.ts',
    );
    assert.doesNotMatch(build, /with \{ type: 'json' \}/u);
    assert.match(build, /const ultramodernBuildArtifact = \{/u);
    assert.match(
      build,
      /export const ultramodernDeliveryUnit =\s*ultramodernBuildArtifact\.deliveryUnit;/u,
    );
    assert.match(
      build,
      /export const ultramodernApiMarker = ultramodernBuildArtifact\.surfaces\.api;/u,
    );

    // Validator-shaped assertions on the restored compact config.
    const compact = JSON.parse(
      read(workspaceDir, '.modernjs/ultramodern.json'),
    );
    const catalog = compact.topology.apps.find(
      (app: any) => app.id === 'catalog',
    );
    assert.equal(catalog.deliveryUnit.kind, 'microvertical-delivery-unit');
    assert.deepEqual(
      catalog.backendFederation.deliveryUnit,
      catalog.deliveryUnit,
    );
    assert.equal(
      catalog.backendFederation.versionBoundary.identityRoot,
      'deliveryUnit',
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('sync-delivery-unit is idempotent and only touches the three target sets', () => {
  const { tempRoot, workspaceDir } = scaffoldWorkspace();
  try {
    stripDeliveryUnitIdentity(workspaceDir);

    const before = snapshotAllFiles(workspaceDir);
    runSyncDeliveryUnit([], {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    });
    const afterFirst = snapshotAllFiles(workspaceDir);

    const changed = [...afterFirst.keys()].filter(
      file => afterFirst.get(file) !== before.get(file),
    );
    const expectedChanged = TARGET_FILES.filter(
      file => file !== 'verticals/catalog/shared/ultramodern-build.json',
    );
    assert.deepEqual(
      changed.sort(),
      expectedChanged.sort(),
      'sync must rewrite stale metadata and leave an in-sync JSON artifact untouched',
    );
    assert.equal(
      afterFirst.get('verticals/catalog/shared/ultramodern-build.json'),
      before.get('verticals/catalog/shared/ultramodern-build.json'),
      'canonical JSON artifact should already be in sync',
    );

    // Second run: no writes at all.
    const status = runSyncDeliveryUnit([], {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    });
    assert.equal(status, 0);
    const afterSecond = snapshotAllFiles(workspaceDir);
    for (const [file, content] of afterSecond) {
      assert.equal(content, afterFirst.get(file), `${file} changed on rerun`);
    }
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('sync-delivery-unit refuses when the compact config is missing', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-du-sync-empty-'));
  try {
    assert.throws(
      () =>
        runSyncDeliveryUnit([], {
          workspaceRoot: tempRoot,
          invocationCwd: tempRoot,
        }),
      /Missing \.modernjs\/ultramodern\.json/u,
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

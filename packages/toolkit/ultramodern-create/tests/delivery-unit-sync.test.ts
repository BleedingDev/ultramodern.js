import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { runSyncDeliveryUnit } from '../src/ultramodern-workspace/delivery-unit-sync';

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

async function scaffoldWorkspace(): Promise<{
  tempRoot: string;
  workspaceDir: string;
}> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-du-sync-'));
  const workspaceDir = path.join(tempRoot, 'du-sync-workspace');
  await generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: 'du-sync-workspace',
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
  return { tempRoot, workspaceDir };
}

function stripDeliveryUnitIdentity(workspaceDir: string) {
  const topologyPath = 'topology/reference-topology.json';
  const topology = JSON.parse(read(workspaceDir, topologyPath));
  if (topology.shell) {
    delete topology.shell.deliveryUnit;
    if (topology.shell.backendFederation) {
      delete topology.shell.backendFederation.deliveryUnit;
      if (topology.shell.backendFederation.versionBoundary) {
        delete topology.shell.backendFederation.versionBoundary.identityRoot;
      }
    }
  }
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

  // Simulate incomplete build modules without the delivery-unit identity export.
  fs.writeFileSync(
    path.join(workspaceDir, 'apps/shell-super-app/shared/ultramodern-build.ts'),
    "export const ultramodernVerticalIdentity = { appId: 'shell-super-app' } as const;\n",
  );
  fs.writeFileSync(
    path.join(workspaceDir, 'verticals/catalog/shared/ultramodern-build.ts'),
    "export const ultramodernVerticalIdentity = { appId: 'catalog' } as const;\n",
  );
}

test('sync-delivery-unit backfills identity blocks matching the generator', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  try {
    stripDeliveryUnitIdentity(workspaceDir);
    const stripped = JSON.parse(
      read(workspaceDir, 'topology/reference-topology.json'),
    );
    assert.equal(stripped.shell.deliveryUnit, undefined);
    assert.ok(
      stripped.verticals.every((app: any) => app.deliveryUnit === undefined),
    );

    const status = await runSyncDeliveryUnit([], {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    });
    assert.equal(status, 0);

    // Check the repaired identity independently of generator output. This
    // catches a shared-oracle regression while keeping the public identity
    // contract explicit.
    const topology = JSON.parse(
      read(workspaceDir, 'topology/reference-topology.json'),
    );
    const shell = topology.shell;
    assert.equal(
      shell.deliveryUnit.unitId,
      'du-sync-workspace/shell-super-app',
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

    // Validate the restored canonical topology.
    const catalog = topology.verticals.find((app: any) => app.id === 'catalog');
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

test('sync-delivery-unit is idempotent and only touches topology and build records', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  try {
    stripDeliveryUnitIdentity(workspaceDir);

    await runSyncDeliveryUnit([], {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    });
    const afterFirst = snapshotAllFiles(workspaceDir);

    // Second run: no writes at all.
    const status = await runSyncDeliveryUnit([], {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    });
    assert.equal(status, 0);
    assert.deepEqual(snapshotAllFiles(workspaceDir), afterFirst);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

test('sync-delivery-unit follows an authored app package version and remains idempotent', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  try {
    const manifestPath = 'verticals/catalog/package.json';
    const manifest = JSON.parse(read(workspaceDir, manifestPath));
    const previousTopology = JSON.parse(
      read(workspaceDir, 'topology/reference-topology.json'),
    );
    const previousMarker =
      previousTopology.verticals[0].deliveryUnit.buildMarker;
    manifest.version = '0.2.0';
    writeJson(workspaceDir, manifestPath, manifest);

    assert.equal(
      await runSyncDeliveryUnit([], {
        workspaceRoot: workspaceDir,
        invocationCwd: workspaceDir,
      }),
      0,
    );
    const topology = JSON.parse(
      read(workspaceDir, 'topology/reference-topology.json'),
    );
    const catalog = topology.verticals.find(
      (entry: { id: string }) => entry.id === 'catalog',
    );
    const build = JSON.parse(
      read(workspaceDir, 'verticals/catalog/shared/ultramodern-build.json'),
    );
    assert.equal(catalog.deliveryUnit.version, '0.2.0');
    assert.notEqual(catalog.deliveryUnit.buildMarker, previousMarker);
    assert.equal(build.deliveryUnit.version, '0.2.0');
    assert.equal(
      build.deliveryUnit.buildMarker,
      catalog.deliveryUnit.buildMarker,
    );

    const afterFirst = snapshotAllFiles(workspaceDir);
    assert.equal(
      await runSyncDeliveryUnit([], {
        workspaceRoot: workspaceDir,
        invocationCwd: workspaceDir,
      }),
      0,
    );
    assert.deepEqual(snapshotAllFiles(workspaceDir), afterFirst);
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

// scripts/ultramodern-renderers/release.mjs overlays the renderer fixture's
// modern.config onto a generated Solid shell. The starter names its main entry
// `main`; the fixture keeps the default `index`, so its build only matches the
// captured UI identity once sync-delivery-unit recaptures it.
test('sync-delivery-unit recaptures a native shell whose config drops the generated main entry name', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-du-sync-entry-'));
  try {
    const workspaceDir = path.join(tempRoot, 'workspace');
    await generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'entry-sync',
      modernVersion: '3.8.3',
      renderer: 'solid',
      enableTailwind: false,
      generateAgentFiles: false,
      packageSource: { strategy: 'workspace' },
    });
    const shell = 'apps/shell-super-app';
    const captured = () =>
      JSON.parse(read(workspaceDir, `${shell}/shared/ultramodern-build.json`))
        .surfaces.ui;
    assert.equal(captured().rendererIdentity.entryName, 'main');
    fs.writeFileSync(
      path.join(workspaceDir, shell, 'modern.config.ts'),
      `import { defineConfig } from '@modern-js/ultramodern-app-tools';

export default defineConfig({ renderer: 'solid', server: { ssr: true } });
`,
    );

    assert.equal(
      await runSyncDeliveryUnit([], {
        workspaceRoot: workspaceDir,
        invocationCwd: workspaceDir,
      }),
      0,
    );
    const ui = captured();
    assert.equal(ui.rendererIdentity.entryName, 'index');
    assert.deepEqual(Object.keys(ui.routerBindings), ['index']);
    const topology = JSON.parse(
      read(workspaceDir, 'topology/reference-topology.json'),
    );
    assert.equal(topology.shell.rendererIdentity.entryName, 'index');
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

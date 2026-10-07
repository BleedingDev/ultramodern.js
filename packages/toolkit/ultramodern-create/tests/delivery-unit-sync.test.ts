import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readUltramodernWorkspaceInputs } from '../src/ultramodern-tooling/config';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import { runSyncDeliveryUnit } from '../src/ultramodern-workspace/delivery-unit-sync';
import { captureWorkspaceRendererEvaluations } from '../src/ultramodern-workspace/renderer-config-evaluation';
import { linkInstalledEffectCompiler } from './helpers/workspace-kit';

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
  linkInstalledEffectCompiler(workspaceDir);
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
    for (const appPath of ['apps/shell-super-app', 'verticals/catalog']) {
      fs.rmSync(
        path.join(workspaceDir, appPath, 'shared/ultramodern-build.json'),
      );
    }
    const stripped = JSON.parse(
      read(workspaceDir, 'topology/reference-topology.json'),
    );
    assert.equal(stripped.shell.deliveryUnit, undefined);
    assert.ok(
      stripped.verticals.every((app: any) => app.deliveryUnit === undefined),
    );
    const shellApps = readUltramodernWorkspaceInputs(workspaceDir).apps.slice(
      0,
      1,
    );
    await assert.rejects(
      () => captureWorkspaceRendererEvaluations(workspaceDir, shellApps),
      /Package identity .* does not match topology/u,
    );

    const status = await runSyncDeliveryUnit([], {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    });
    assert.equal(status, 0);
    assert.equal(
      (await captureWorkspaceRendererEvaluations(workspaceDir, shellApps)).size,
      1,
    );

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
    const beforeFirst = snapshotAllFiles(workspaceDir);

    await runSyncDeliveryUnit([], {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    });
    const afterFirst = snapshotAllFiles(workspaceDir);
    const allowedChanges = new Set([
      'topology/reference-topology.json',
      'apps/shell-super-app/shared/ultramodern-build.ts',
      'apps/shell-super-app/shared/ultramodern-build.json',
      'verticals/catalog/shared/ultramodern-build.ts',
      'verticals/catalog/shared/ultramodern-build.json',
    ]);
    assert.deepEqual([...afterFirst.keys()], [...beforeFirst.keys()]);
    for (const [relativePath, content] of afterFirst) {
      if (content !== beforeFirst.get(relativePath)) {
        assert.ok(allowedChanges.has(relativePath), relativePath);
      }
    }

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
    const catalogApps = readUltramodernWorkspaceInputs(workspaceDir).verticals;
    await assert.rejects(
      () => captureWorkspaceRendererEvaluations(workspaceDir, catalogApps),
      /Delivery unit version .* does not match package\.json/u,
    );

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
    assert.equal(
      (await captureWorkspaceRendererEvaluations(workspaceDir, catalogApps))
        .size,
      1,
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

test('sync-delivery-unit leaves authored manifests and configs untouched on failure', async () => {
  const { tempRoot, workspaceDir } = await scaffoldWorkspace();
  try {
    stripDeliveryUnitIdentity(workspaceDir);
    const manifestPath = 'verticals/catalog/package.json';
    const manifest = JSON.parse(read(workspaceDir, manifestPath));
    const configPath = 'verticals/catalog/modern.config.ts';
    const topologyPath = 'topology/reference-topology.json';
    const foreignTopology = JSON.parse(read(workspaceDir, topologyPath));
    foreignTopology.verticals[0].package = '@foreign/catalog';
    const foreignManifest = JSON.stringify({
      ...manifest,
      name: '@foreign/catalog',
    });
    const failures: { files: Record<string, string>; expected: RegExp }[] = [
      {
        files: { [manifestPath]: foreignManifest },
        expected: /package identity disagrees/u,
      },
      {
        files: {
          [manifestPath]: foreignManifest,
          [topologyPath]: JSON.stringify(foreignTopology),
        },
        expected: /delivery-unit package identity disagrees/u,
      },
      {
        files: {
          [manifestPath]: JSON.stringify({ ...manifest, version: ' ' }),
        },
        expected: /requires a package version/u,
      },
      {
        files: {
          [configPath]: `import { defineConfig, presetUltramodernWorkspace } from '@modern-js/ultramodern-app-tools';
export default defineConfig(presetUltramodernWorkspace(
  { renderer: 'solid' },
  { appId: 'catalog', from: import.meta.url },
));
`,
        },
        expected: /Renderer for catalog does not match topology/u,
      },
      {
        files: {
          [configPath]: `${read(workspaceDir, configPath)}\nthrow new Error('authored config rejected');\n`,
        },
        expected: /authored config rejected/u,
      },
    ];
    for (const { files, expected } of failures) {
      const originals = new Map<string, string>();
      for (const [relativePath, content] of Object.entries(files)) {
        originals.set(relativePath, read(workspaceDir, relativePath));
        fs.writeFileSync(path.join(workspaceDir, relativePath), content);
      }
      const before = snapshotAllFiles(workspaceDir);
      const beforeSiblings = fs.readdirSync(tempRoot);
      await assert.rejects(
        () =>
          runSyncDeliveryUnit([], {
            workspaceRoot: workspaceDir,
            invocationCwd: workspaceDir,
          }),
        expected,
      );
      assert.deepEqual(snapshotAllFiles(workspaceDir), before);
      assert.deepEqual(fs.readdirSync(tempRoot), beforeSiblings);
      for (const [relativePath, content] of originals) {
        fs.writeFileSync(path.join(workspaceDir, relativePath), content);
      }
    }
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
    const initialTopology = JSON.parse(
      read(workspaceDir, 'topology/reference-topology.json'),
    );
    // Reconciliation must work when renderer projections need backfilling too.
    for (const field of [
      'renderer',
      'rendererIdentity',
      'rendererIdentities',
      'rendererProfile',
      'rendererGenerationProfile',
      'routerBindings',
      'rendererCapabilities',
    ]) {
      delete initialTopology.shell[field];
    }
    writeJson(
      workspaceDir,
      'topology/reference-topology.json',
      initialTopology,
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

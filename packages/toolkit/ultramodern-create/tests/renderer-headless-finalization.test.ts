import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
  type UltramodernGenerationResult,
} from '../src/ultramodern-workspace';
import { snapshotWorkspace } from './helpers/workspace-kit';

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function fixture() {
  const tempRoot = fs.mkdtempSync(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'um-headless-finalization-',
    ),
  );
  const workspaceRoot = path.join(tempRoot, 'workspace');
  try {
    const generated = await generateUltramodernWorkspace({
      targetDir: workspaceRoot,
      packageName: 'headless-finalization',
      modernVersion: '3.8.3',
      renderer: 'solid',
      enableTailwind: false,
      generateAgentFiles: false,
      packageSource: { strategy: 'workspace' },
    });
    const generator = path.join(tempRoot, 'headless-overlay');
    fs.mkdirSync(generator);
    fs.writeFileSync(
      path.join(generator, 'package.json'),
      JSON.stringify({
        name: 'test-headless-finalization-overlay',
        version: '0.0.0',
        main: './index.cjs',
      }),
    );
    fs.writeFileSync(
      path.join(generator, 'index.cjs'),
      `const fs = require('node:fs');
const path = require('node:path');

module.exports = async context => {
  const { outputWorkspaceRoot, generatedApp, mode, trace, uiValue } = context.config;
  const directory = path.join(outputWorkspaceRoot, generatedApp.directory);
  if (mode === 'callback') {
    const configPath = path.join(directory, 'modern.config.ts');
    fs.copyFileSync(configPath, path.join(directory, 'headless-base.config.ts'));
    fs.writeFileSync(configPath, 
      "import base from './headless-base.config';\\n" +
      "import { appendFileSync } from 'node:fs';\\n" +
      "export default async context => {\\n" +
      "  appendFileSync(" + JSON.stringify(trace) + ", 'headless-callback-invoked\\\\n');\\n" +
      "  return typeof base === 'function' ? await base(context) : base;\\n" +
      "};\\n");
  }
  if (mode === 'invalid-ui') {
    const artifactPath = path.join(directory, 'shared/ultramodern-build.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    artifact.surfaces.ui = uiValue;
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\\n');
  }
};
`,
    );
    return {
      workspaceRoot,
      tempRoot,
      primaryShell: generated.createdApps[0]!,
      options(name = 'headless') {
        return {
          workspaceRoot,
          name,
          modernVersion: '3.8.3',
          preset: 'api-only' as const,
        };
      },
      overlays(config: Record<string, unknown>) {
        return [{ generator, config }];
      },
      clean() {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function assertHeadlessIdentity(
  workspaceRoot: string,
  result: UltramodernGenerationResult,
): void {
  const app = result.createdApps[0]!;
  const directory = path.join(workspaceRoot, app.directory);
  const topology = readJson(
    path.join(workspaceRoot, 'topology/reference-topology.json'),
  );
  const entry = topology.verticals.find(
    (candidate: { id: string }) => candidate.id === app.id,
  );
  const artifact = readJson(
    path.join(directory, 'shared/ultramodern-build.json'),
  );
  const manifest = readJson(path.join(directory, 'package.json'));
  assert.ok(entry);
  assert.equal(app.renderer, 'none');
  assert.equal(entry.renderer, 'none');
  assert.equal(artifact.kind, 'ultramodern-build-artifact');
  assert.equal(artifact.schemaVersion, 2);
  assert.deepEqual(Object.keys(artifact.surfaces), ['api']);
  assert.equal(artifact.surfaces.api.surface, 'api');
  for (const projection of [
    app,
    entry,
    artifact.deliveryUnit,
    artifact.surfaces.api,
  ]) {
    for (const field of [
      'rendererIdentity',
      'rendererIdentities',
      'rendererProfile',
      'routerBindings',
      'rendererCapabilities',
    ]) {
      assert.equal(Object.hasOwn(projection, field), false, field);
    }
  }
  assert.equal(Object.hasOwn(artifact.surfaces, 'ui'), false);
  assert.equal(Object.hasOwn(entry, 'moduleFederation'), false);
  assert.equal(Object.hasOwn(app, 'moduleFederationName'), false);
  assert.deepEqual(result.moduleFederationNames, {});
  for (const record of [artifact.deliveryUnit, artifact.surfaces.api]) {
    assert.ok(record);
    assert.equal(record.version, manifest.version);
    assert.equal(record.unitId, entry.deliveryUnit.unitId);
    assert.equal(record.buildMarker, entry.deliveryUnit.buildMarker);
  }
  assert.equal(
    result.deliveryUnits![0]!.buildMarker,
    entry.deliveryUnit.buildMarker,
  );
  assert.equal(result.deliveryUnits![0]!.unitId, entry.deliveryUnit.unitId);
  assert.equal(
    result.deliveryUnits![0]!.baselineCohort.resolved.renderer,
    'none',
  );
  assert.deepEqual(
    result.deliveryUnits![0]!.surfaces.map(surface => surface.kind),
    ['api'],
  );
  for (const relativePath of [
    'src/routes',
    'src/modern.runtime.ts',
    'module-federation.config.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(directory, relativePath)), false);
  }
}

test('adding an API-only unit without overlays rejects inherited renderer dependencies and preserves the live workspace', async () => {
  const f = await fixture();
  try {
    const packagePath = path.join(
      f.workspaceRoot,
      f.primaryShell.directory,
      'package.json',
    );
    const manifest = readJson(packagePath);
    manifest.dependencies['@solidjs/testing-library'] = 'workspace:*';
    fs.writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
    const before = snapshotWorkspace(f.workspaceRoot);
    await assert.rejects(
      addUltramodernVertical(f.options()),
      /headless.*dependencies contains foreign renderer package @solidjs\/testing-library/u,
    );
    assert.deepEqual(snapshotWorkspace(f.workspaceRoot), before);
    assert.equal(
      fs.existsSync(path.join(f.workspaceRoot, 'verticals/headless')),
      false,
    );
  } finally {
    f.clean();
  }
});

test('adding an API-only unit without overlays publishes schema 2 API identity without UI projections', async () => {
  const f = await fixture();
  try {
    const result = await addUltramodernVertical(f.options());
    assertHeadlessIdentity(f.workspaceRoot, result);
  } finally {
    f.clean();
  }
});

test('new and existing headless config callbacks remain authored and are never invoked for renderer metadata', async () => {
  const f = await fixture();
  try {
    const trace = path.join(f.tempRoot, 'headless-callback-observations.txt');
    const first = await addUltramodernVertical({
      ...f.options(),
      overlays: f.overlays({ mode: 'callback', trace }),
    });
    assertHeadlessIdentity(f.workspaceRoot, first);
    assert.equal(fs.existsSync(trace), false);
    const configPath = path.join(
      f.workspaceRoot,
      first.createdApps[0]!.directory,
      'modern.config.ts',
    );
    const authoredConfig = fs.readFileSync(configPath, 'utf8');
    assert.match(authoredConfig, /headless-callback-invoked/u);
    const second = await addUltramodernVertical(f.options('other-headless'));
    assertHeadlessIdentity(f.workspaceRoot, second);
    assert.equal(fs.existsSync(trace), false);
    assert.equal(fs.readFileSync(configPath, 'utf8'), authoredConfig);
  } finally {
    f.clean();
  }
});

for (const uiValue of [null, false]) {
  test(`a headless overlay cannot smuggle a ${String(uiValue)} UI property through artifact regeneration`, async () => {
    const f = await fixture();
    try {
      const before = snapshotWorkspace(f.workspaceRoot);
      await assert.rejects(
        addUltramodernVertical({
          ...f.options(),
          overlays: f.overlays({ mode: 'invalid-ui', uiValue }),
        }),
        /Headless build must omit its UI renderer surface/u,
      );
      assert.deepEqual(snapshotWorkspace(f.workspaceRoot), before);
      assert.equal(
        fs.existsSync(path.join(f.workspaceRoot, 'verticals/headless')),
        false,
      );
    } finally {
      f.clean();
    }
  });
}

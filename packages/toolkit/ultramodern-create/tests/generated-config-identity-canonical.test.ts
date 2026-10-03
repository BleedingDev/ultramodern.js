import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertUltramodernBuildArtifact } from '@modern-js/backend-federation-contracts';
import { normalizeWorkspaceInputs } from '../src/ultramodern-tooling/config';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';
import { createBuildMarker } from '../src/ultramodern-workspace/delivery-unit';
import { shellApp } from '../src/ultramodern-workspace/descriptors';
import { formatGeneratedSourceCandidates } from '../src/ultramodern-workspace/fs-io';
import { createAppModernConfig } from '../src/ultramodern-workspace/module-federation';
import { initializeGeneratedRendererIdentity } from '../src/ultramodern-workspace/renderer-initial-identity';
import { preserveConsumerWorkspaceArtifacts } from '../src/ultramodern-workspace/workspace-artifact-ownership';

test('genuine initial React config remains canonical after native router identity resolution', async () => {
  const directory = fs.realpathSync.native(
    fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'um-config-identity-canonical-',
      ),
    ),
  );
  const root = path.join(directory, 'workspace');
  try {
    const result = await generateUltramodernWorkspace({
      targetDir: root,
      packageName: 'config-identity-canonical',
      modernVersion: '3.8.3',
      renderer: 'react',
      enableTailwind: false,
      generateAgentFiles: false,
      packageSource: { strategy: 'workspace' },
    });
    const generated = result.createdApps.find(app => app.id === shellApp.id);
    assert.ok(generated);
    const topology = JSON.parse(
      fs.readFileSync(
        path.join(root, 'topology/reference-topology.json'),
        'utf8',
      ),
    );
    const overlay = JSON.parse(
      fs.readFileSync(
        path.join(root, 'topology/local-overlays/development.json'),
        'utf8',
      ),
    );
    // This is declarative normalization of already resolved metadata. It never
    // loads modern.config or invokes its preset/callback a second time.
    const app = normalizeWorkspaceInputs(root, { topology, overlay })
      .primaryShell!;
    assert.equal(app.renderer, 'react');
    assert.deepEqual(app.routerBindings, generated.routerBindings);
    assert.ok(app.rendererIdentity);
    assert.equal(app.rendererIdentity.entryName, 'index');
    assert.ok(app.routerBindings?.[app.rendererIdentity.entryName]);

    const version = app.deliveryUnit?.version;
    const finalMarker = app.deliveryUnit?.buildMarker;
    assert.equal(typeof version, 'string');
    assert.equal(typeof finalMarker, 'string');
    assert.equal(finalMarker, app.rendererIdentity.buildId);
    assert.equal(
      finalMarker,
      createBuildMarker(result.packageScope, app, version),
    );
    assert.notEqual(
      finalMarker,
      createBuildMarker(
        result.packageScope,
        { ...app, routerBindings: undefined },
        version,
      ),
    );
    const artifact: unknown = JSON.parse(
      fs.readFileSync(
        path.join(root, app.directory, 'shared/ultramodern-build.json'),
        'utf8',
      ),
    );
    assertUltramodernBuildArtifact(artifact);
    assert.equal(artifact.deliveryUnit.buildMarker, finalMarker);
    assert.deepEqual(artifact.surfaces.ui?.routerBindings, app.routerBindings);

    const relativePath = `${app.directory}/modern.config.ts`;
    const filename = path.join(root, relativePath);
    const original = fs.readFileSync(filename, 'utf8');
    const provisional = initializeGeneratedRendererIdentity(
      result.packageScope,
      { ...shellApp, verticalRefs: [] },
      version,
    ).deliveryUnit?.buildMarker;
    const sourceMarker = original.match(
      /buildMarker:\s*(['"])([a-f0-9]{16})\1/u,
    )?.[2];
    assert.equal(sourceMarker, provisional);
    assert.notEqual(sourceMarker, finalMarker);

    const reconstructed = createAppModernConfig(
      result.packageScope,
      app,
      [],
      false,
    );
    const [canonical] = formatGeneratedSourceCandidates([
      [relativePath, reconstructed],
    ]);
    assert.equal(original, canonical);
    const ownership = preserveConsumerWorkspaceArtifacts(root, [
      { relativePath, content: reconstructed },
    ]);
    assert.equal(ownership.canonicalGeneratedPaths.has(relativePath), true);
    assert.equal(ownership.io.write(filename, reconstructed), false);
    assert.equal(fs.readFileSync(filename, 'utf8'), original);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

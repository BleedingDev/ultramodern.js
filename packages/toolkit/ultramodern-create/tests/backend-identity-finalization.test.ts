import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runValidate } from '../src/ultramodern-tooling/commands/validate';
import { readResolvedUltramodernWorkspaceInputs } from '../src/ultramodern-tooling/config';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { stampDeliveryUnitIdentity } from '../src/ultramodern-workspace/delivery-unit-stamp';
import { createWorkspace, snapshotWorkspace } from './helpers/workspace-kit';

test('resolved renderer identity binds topology and development backend execution and rejects drift', async () => {
  const { tempRoot, workspaceDir } = await createWorkspace('backend-identity', {
    tempPrefix: 'um-backend-identity-',
  });
  try {
    await addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const topologyFile = path.join(
      workspaceDir,
      'topology/reference-topology.json',
    );
    const overlayFile = path.join(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    const topologyBytes = fs.readFileSync(topologyFile, 'utf8');
    const overlayBytes = fs.readFileSync(overlayFile, 'utf8');
    const topology = JSON.parse(topologyBytes);
    const catalog = topology.verticals.find(
      (app: { id: string }) => app.id === 'catalog',
    );
    const overlay = JSON.parse(overlayBytes);
    const artifact = JSON.parse(
      fs.readFileSync(
        path.join(
          workspaceDir,
          'verticals/catalog/shared/ultramodern-build.json',
        ),
        'utf8',
      ),
    );
    const expected = {
      unitId: artifact.deliveryUnit.unitId,
      buildMarker: artifact.deliveryUnit.buildMarker,
    };
    assert.equal(catalog.deliveryUnit.buildMarker, expected.buildMarker);
    assert.equal(
      catalog.rendererIdentity.buildId,
      artifact.surfaces.ui.rendererIdentity.buildId,
    );
    assert.equal(
      catalog.backendFederation.deliveryUnit.buildMarker,
      expected.buildMarker,
    );
    assert.deepEqual(
      catalog.backendFederation.executionSurfaces.node.expected,
      expected,
    );
    assert.deepEqual(overlay.serverExecution.catalog.deliveryUnit, expected);
    assert.deepEqual(overlay.serverExecution.catalog.node.expected, expected);
    const context = {
      workspaceRoot: workspaceDir,
      invocationCwd: workspaceDir,
    };
    const before = snapshotWorkspace(workspaceDir);
    assert.equal(await runValidate(context), 0);
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);

    catalog.backendFederation.executionSurfaces.node.expected.buildMarker =
      'deadbeefdeadbeef';
    fs.writeFileSync(topologyFile, JSON.stringify(topology));
    const staleNode = snapshotWorkspace(workspaceDir);
    await assert.rejects(
      () => runValidate(context),
      /catalog backend federation node identity contradicts topology/u,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), staleNode);
    fs.writeFileSync(topologyFile, topologyBytes);

    overlay.serverExecution.catalog.deliveryUnit.buildMarker =
      'deadbeefdeadbeef';
    fs.writeFileSync(overlayFile, JSON.stringify(overlay));
    const staleOverlay = snapshotWorkspace(workspaceDir);
    await assert.rejects(
      () => runValidate(context),
      /catalog server execution identity contradicts topology/u,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), staleOverlay);
    fs.writeFileSync(overlayFile, overlayBytes);

    const staleOverlayNode = JSON.parse(overlayBytes);
    staleOverlayNode.serverExecution.catalog.node.expected.buildMarker =
      'deadbeefdeadbeef';
    fs.writeFileSync(overlayFile, JSON.stringify(staleOverlayNode));
    const staleOverlayNodeBytes = snapshotWorkspace(workspaceDir);
    await assert.rejects(
      () => runValidate(context),
      /catalog server execution node identity contradicts topology/u,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), staleOverlayNodeBytes);
    delete staleOverlayNode.serverExecution.catalog.node.expected;
    fs.writeFileSync(overlayFile, JSON.stringify(staleOverlayNode));
    const omittedOverlayExpectation = snapshotWorkspace(workspaceDir);
    assert.equal(await runValidate(context), 0);
    assert.deepEqual(
      snapshotWorkspace(workspaceDir),
      omittedOverlayExpectation,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('restamping backend identity preserves authored node endpoints and unrelated expected constraints', async () => {
  const { tempRoot, workspaceDir } = await createWorkspace('backend-restamp', {
    tempPrefix: 'um-backend-restamp-',
  });
  try {
    await addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const resolved = await readResolvedUltramodernWorkspaceInputs(workspaceDir);
    const app = resolved.verticals.find(app => app.id === 'catalog')!;
    const entry = structuredClone(resolved.raw.topology.verticals[0]);
    const node = entry.backendFederation.executionSurfaces.node;
    node.manifestUrl = 'https://backend.example.test/catalog/manifest.json';
    node.containerEntry = 'https://backend.example.test/catalog/entry.cjs';
    node.expected.packageName = app.deliveryUnit!.packageName;
    const authored = { ...node };
    stampDeliveryUnitIdentity(entry, 'backend-restamp', app, '9.8.7');
    assert.notEqual(
      entry.deliveryUnit.buildMarker,
      app.deliveryUnit!.buildMarker,
    );
    assert.deepEqual(node, {
      ...authored,
      expected: {
        ...authored.expected,
        unitId: entry.deliveryUnit.unitId,
        buildMarker: entry.deliveryUnit.buildMarker,
      },
    });
    assert.equal(entry.backendFederation.deliveryUnit.version, '9.8.7');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

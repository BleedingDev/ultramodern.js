import assert from 'node:assert/strict';
import { createDeliveryUnitRecord } from '../src/ultramodern-workspace/delivery-unit';
import { projectDeliveryUnitToV1 } from '../src/ultramodern-workspace/delivery-unit-schema/types';
import { createNeutralOwnership } from '../src/ultramodern-workspace/descriptors';
import { createGenerationResult } from '../src/ultramodern-workspace/generation-result';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';

const scope = 'acme';

const shell: WorkspaceApp = {
  id: 'shell-super-app',
  directory: 'apps/shell-super-app',
  packageSuffix: 'shell-super-app',
  displayName: 'Shell',
  kind: 'shell',
  portEnv: 'SHELL_SUPER_APP_PORT',
  port: 3020,
  mfName: 'shellSuperApp',
  ownership: createNeutralOwnership('shell-super-app', 'tier-0-shell'),
};

const apiVertical: WorkspaceApp = {
  id: 'checkout',
  directory: 'verticals/checkout',
  packageSuffix: 'checkout',
  displayName: 'Checkout Vertical',
  kind: 'vertical',
  domain: 'checkout',
  portEnv: 'VERTICAL_CHECKOUT_PORT',
  port: 3030,
  mfName: 'verticalCheckout',
  exposes: { './Cart': 'src/expose/Cart.tsx' },
  api: {
    stem: 'checkout',
    prefix: '/checkout-api',
    consumedBy: ['shell-super-app', 'checkout'],
  },
  ownership: createNeutralOwnership('checkout'),
};

const uiOnlyVertical: WorkspaceApp = {
  id: 'catalog',
  directory: 'verticals/catalog',
  packageSuffix: 'catalog',
  displayName: 'Catalog Vertical',
  kind: 'vertical',
  domain: 'catalog',
  portEnv: 'VERTICAL_CATALOG_PORT',
  port: 3031,
  mfName: 'verticalCatalog',
  exposes: { './Grid': 'src/expose/Grid.tsx' },
  ownership: createNeutralOwnership('catalog'),
};

function buildResult() {
  return createGenerationResult({
    operation: 'workspace',
    workspaceRoot: '/tmp/ws',
    packageScope: scope,
    packageSource: {
      strategy: 'workspace',
      modernPackageVersion: 'workspace:*',
    },
    createdApps: [shell, apiVertical, uiOnlyVertical],
    createdPaths: [],
    rewrittenPaths: [],
  });
}

test('generation result exposes a delivery-unit descriptor per app of every kind (G1d)', () => {
  const result = buildResult();
  assert.ok(result.deliveryUnits, 'deliveryUnits must be present');
  assert.deepEqual(
    result.deliveryUnits?.map(unit => unit.unitId),
    ['acme/shell-super-app', 'acme/checkout', 'acme/catalog'],
  );
  assert.deepEqual(
    result.deliveryUnits?.map(unit => unit.kind),
    ['shell', 'microvertical', 'microvertical'],
  );
});

test('descriptor identity matches the emitted delivery-unit records (G1d)', () => {
  const result = buildResult();
  for (const app of [shell, apiVertical, uiOnlyVertical]) {
    const record = createDeliveryUnitRecord(scope, app);
    const descriptor = result.deliveryUnits?.find(
      unit => unit.unitId === record.unitId,
    );
    assert.ok(descriptor, `descriptor missing for ${record.unitId}`);
    assert.equal(descriptor?.buildMarker, record.buildMarker);
    assert.equal(descriptor?.sourceRevision, record.sourceRevision);
  }
});

test('down-projecting a descriptor reproduces the v1 delivery-unit identity (G1d)', () => {
  const result = buildResult();
  const descriptor = result.deliveryUnits?.find(
    unit => unit.unitId === 'acme/checkout',
  );
  assert.ok(descriptor);
  const projection = projectDeliveryUnitToV1(descriptor, {
    directory: apiVertical.directory,
    packageSuffix: apiVertical.packageSuffix,
    displayName: apiVertical.displayName,
    portEnv: apiVertical.portEnv,
    port: apiVertical.port,
    mfName: apiVertical.mfName,
    ownership: apiVertical.ownership,
    packageName: '@acme/checkout',
    version: '0.1.0',
  });
  assert.equal(projection.deliveryUnitRecord.unitId, descriptor.unitId);
  assert.equal(
    projection.deliveryUnitRecord.buildMarker,
    descriptor.buildMarker,
  );
  assert.equal(projection.app.kind, 'vertical');
  assert.equal(projection.app.api?.stem, 'checkout');
  assert.equal(projection.app.api?.prefix, '/checkout-api');
});

test('descriptor owner defaults to the neutral team owner (G1d + G3)', () => {
  const result = buildResult();
  for (const descriptor of result.deliveryUnits ?? []) {
    assert.deepEqual(descriptor.owner, {
      kind: 'team',
      id: 'super-app-platform',
    });
  }
});

test('additive: existing result fields are preserved (G1d)', () => {
  const result = buildResult();
  assert.equal(result.operation, 'workspace');
  assert.equal(result.packageScope, scope);
  assert.equal(result.createdApps.length, 3);
  assert.equal(result.assignedPorts.checkout, 3030);
  assert.equal(result.apiPrefixes.checkout, '/checkout-api');
  assert.equal(
    result.moduleFederationNames['shell-super-app'],
    'shellSuperApp',
  );
});

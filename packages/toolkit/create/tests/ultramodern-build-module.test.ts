import assert from 'node:assert/strict';
import { createDeliveryUnitRecord } from '../src/ultramodern-workspace/delivery-unit';
import { createNeutralOwnership } from '../src/ultramodern-workspace/descriptors';
import { createUltramodernBuildModule } from '../src/ultramodern-workspace/module-federation/reexport-module';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';

const app: WorkspaceApp = {
  api: {
    consumedBy: ['shell-super-app', 'catalog'],
    prefix: '/catalog-api',
    stem: 'catalog',
  },
  directory: 'verticals/catalog',
  displayName: 'Catalog Vertical',
  domain: 'catalog',
  exposes: {
    './Widget': 'src/components/catalog-widget.tsx',
  },
  id: 'catalog',
  kind: 'vertical',
  mfName: 'verticalCatalog',
  ownership: createNeutralOwnership('catalog'),
  packageSuffix: 'catalog',
  port: 3021,
  portEnv: 'VERTICAL_CATALOG_PORT',
};

test('generated build module applies one compiled identity to UI, API, and delivery-unit records', () => {
  const source = createUltramodernBuildModule('acme', app);
  const generationRecord = createDeliveryUnitRecord('acme', app);

  assert.match(source, /declare const ULTRAMODERN_BUILD_MARKER: string;/u);
  assert.match(source, /declare const ULTRAMODERN_SOURCE_REVISION: string;/u);
  assert.match(
    source,
    /deliveryUnit:[\s\S]*?buildMarker: ultramodernBuildMarker,[\s\S]*?sourceRevision: ultramodernSourceRevision,/u,
  );
  assert.match(
    source,
    /api:[\s\S]*?buildMarker: ultramodernBuildMarker,[\s\S]*?sourceRevision: ultramodernSourceRevision,/u,
  );
  assert.match(
    source,
    /ui:[\s\S]*?buildMarker: ultramodernBuildMarker,[\s\S]*?sourceRevision: ultramodernSourceRevision,/u,
  );
  assert.match(source, new RegExp(generationRecord.buildMarker, 'u'));
  assert.match(source, /sourceRevision": "workspace"/u);
});

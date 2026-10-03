import assert from 'node:assert/strict';
import { createDeliveryUnitRecord } from '../src/ultramodern-workspace/delivery-unit';
import { createNeutralOwnership } from '../src/ultramodern-workspace/descriptors';
import {
  createUltramodernBuildArtifactJson,
  createUltramodernBuildModule,
} from '../src/ultramodern-workspace/module-federation/reexport-module';
import type { WorkspaceApp } from '../src/ultramodern-workspace/types';
import {
  createReactBuildFixtureApp,
  evaluateBuildModule,
} from './helpers/build-module';

const app: WorkspaceApp = createReactBuildFixtureApp('acme', {
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
});

test('generated build module applies one compiled identity to UI, API, and delivery-unit records', () => {
  const source = createUltramodernBuildModule('acme', app);
  const artifactJson = createUltramodernBuildArtifactJson('acme', app);
  const generationRecord = createDeliveryUnitRecord('acme', app);
  const execute = (globals: Record<string, string>) => {
    const exports = evaluateBuildModule(source, artifactJson, globals);
    assert.deepEqual(Object.keys(exports).sort(), [
      'ultramodernApiMarker',
      'ultramodernDeliveryUnit',
      'ultramodernUiMarker',
    ]);
    return {
      deliveryUnit: exports.ultramodernDeliveryUnit,
      surfaces: {
        api: exports.ultramodernApiMarker,
        ui: exports.ultramodernUiMarker,
      },
    };
  };
  const fallback = execute({});
  const generatedArtifact = JSON.parse(artifactJson);
  assert.deepEqual(fallback.deliveryUnit, generatedArtifact.deliveryUnit);
  assert.deepEqual(fallback.surfaces, generatedArtifact.surfaces);
  assert.equal(fallback.deliveryUnit.buildMarker, generationRecord.buildMarker);
  assert.equal(fallback.deliveryUnit.sourceRevision, 'workspace');

  const compiledIdentity = execute({
    ULTRAMODERN_BUILD_MARKER: 'compiled-marker',
    ULTRAMODERN_SOURCE_REVISION: 'compiled-revision',
  });
  for (const identity of [
    compiledIdentity.deliveryUnit,
    compiledIdentity.surfaces.api,
    compiledIdentity.surfaces.ui,
  ]) {
    assert.equal(identity.unitId, generationRecord.unitId);
    assert.equal(identity.build, 'compiled-marker');
    assert.equal(identity.buildMarker, 'compiled-marker');
    assert.equal(identity.sourceRevision, 'compiled-revision');
  }
});

test('shell build modules expose the delivery and UI identity consumed by their pages', () => {
  const shell: WorkspaceApp = {
    ...app,
    kind: 'shell',
  };
  const source = createUltramodernBuildModule('acme', shell);
  const artifactJson = createUltramodernBuildArtifactJson('acme', shell);
  const exports = evaluateBuildModule(source, artifactJson);
  assert.deepEqual(Object.keys(exports).sort(), [
    'ultramodernDeliveryUnit',
    'ultramodernUiMarker',
  ]);
  assert.deepEqual(
    exports.ultramodernDeliveryUnit,
    JSON.parse(artifactJson).deliveryUnit,
  );
  assert.deepEqual(
    exports.ultramodernUiMarker,
    JSON.parse(artifactJson).surfaces.ui,
  );
  assert.match(source, /export const ultramodernDeliveryUnit/u);
  assert.match(source, /export const ultramodernUiMarker/u);
  assert.doesNotMatch(source, /export const ultramodernApiMarker/u);
  assert.doesNotMatch(source, /typeof|surfaces: \{[\s\S]*surfaces:/u);
});

test('build artifacts reject unresolved or drifted renderer entry identities and router bindings', () => {
  const primaryIdentity = app.rendererIdentity!;
  const binding = app.routerBindings!.index!;
  const foreignProvider = {
    ...binding.defaultProvider,
    framework: 'solid' as const,
  };
  const scenarios: { app: WorkspaceApp; error: RegExp }[] = [
    {
      app: { ...app, renderer: undefined },
      error: /requires a resolved renderer profile/u,
    },
    {
      app: { ...app, rendererIdentities: undefined },
      error: /requires renderer identity reconciled from modern.config/u,
    },
    {
      app: {
        ...app,
        rendererIdentities: {
          index: { ...primaryIdentity, appId: 'different-app' },
        },
      },
      error: /invalid renderer identity for entry index/u,
    },
    {
      app: {
        ...app,
        rendererIdentities: {
          index: { ...primaryIdentity, buildId: 'different-build' },
        },
      },
      error: /primary renderer identity disagrees with its entry map/u,
    },
    {
      app: {
        ...app,
        routerBindings: {
          index: {
            ...binding,
            defaultProvider: foreignProvider,
            providers: [foreignProvider],
          },
        },
      },
      error: /invalid router bindings/u,
    },
  ];
  for (const scenario of scenarios) {
    assert.throws(
      () => createUltramodernBuildArtifactJson('acme', scenario.app),
      scenario.error,
    );
  }
});

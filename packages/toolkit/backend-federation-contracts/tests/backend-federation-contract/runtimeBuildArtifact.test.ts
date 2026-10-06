import { runInNewContext } from 'node:vm';
import {
  assertRendererProfileCompatibility,
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
  type RendererProfile,
  type RendererRouterBindings,
  type RouterPackageBinding,
  resolveUltramodernBuildArtifact,
  validateUltramodernBuildArtifact,
} from '../../src/backend-federation-contract';

const deliveryUnit: DeliveryUnitRecord = {
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  kind: DELIVERY_UNIT_KIND,
  appId: 'catalog',
  unitId: 'shop/catalog',
  packageName: '@shop/catalog',
  version: '0.1.0',
  deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
  buildMarker: 'original',
  sourceRevision: 'workspace',
};

const reactProfile: RendererProfile = {
  renderer: 'react',
  protocolVersion: 1,
  compiler: { name: '@rsbuild/plugin-react', version: '2.1.1' },
  hydration: { name: 'react-dom', version: '19.3.0' },
  router: {
    name: '@tanstack/react-router',
    version: '1.170.41',
    coreName: '@tanstack/router-core',
    coreVersion: '1.171.34',
  },
};

const nativeProfiles: RendererProfile[] = [
  {
    renderer: 'solid',
    protocolVersion: 1,
    compiler: { name: '@solidjs/compiler', version: '2.0.0-rc.13' },
    hydration: { name: '@solidjs/web', version: '2.0.0-rc.13' },
    router: {
      name: '@tanstack/solid-router',
      version: '2.0.0-rc.8',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.22',
    },
  },
  {
    renderer: 'octane',
    protocolVersion: 1,
    compiler: { name: '@octanejs/rspack-plugin', version: '0.1.55' },
    hydration: { name: 'octane', version: '0.7.1' },
    router: {
      name: '@octanejs/tanstack-router',
      version: '0.1.60',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.15',
    },
  },
];

// Controlled owner evidence for runtime fixtures, not installed-package admission.
const controlledRouterBindings = (
  profile: RendererProfile,
): RendererRouterBindings => {
  const provider: RouterPackageBinding = {
    framework: profile.renderer === 'react' ? 'tanstack' : profile.renderer,
    ...profile.router,
  };
  return {
    main: {
      owner: `@fixture/${profile.renderer}-router-owner`,
      evidence: 'file-routes',
      defaultProvider: provider,
      providers: [provider],
    },
  };
};

const artifact = createUltramodernBuildArtifact(deliveryUnit, {
  ui: {
    identity: {
      renderer: 'react',
      appId: deliveryUnit.appId,
      entryName: 'main',
      protocolVersion: 1,
      buildId: deliveryUnit.buildMarker,
    },
    profile: reactProfile,
    routerBindings: controlledRouterBindings(reactProfile),
  },
});

const readers = {
  buildMarker: () => 'compiled-build',
  sourceRevision: () => 'compiled-revision',
};

it('uses compiler identity consistently without changing renderer compatibility', () => {
  const result = resolveUltramodernBuildArtifact(artifact, readers);

  expect(validateUltramodernBuildArtifact(result)).toEqual({
    ok: true,
    errors: [],
  });
  expect(result.deliveryUnit).toMatchObject({
    build: 'compiled-build',
    buildMarker: 'compiled-build',
    sourceRevision: 'compiled-revision',
  });
  expect(result.surfaces.api).toMatchObject(result.deliveryUnit);
  expect(result.surfaces.ui).toMatchObject({
    ...result.deliveryUnit,
    rendererIdentity: {
      renderer: 'react',
      appId: 'catalog',
      entryName: 'main',
      protocolVersion: 1,
      buildId: 'compiled-build',
    },
    rendererProfile: reactProfile,
    routerBindings: controlledRouterBindings(reactProfile),
  });
  expect(() =>
    assertRendererProfileCompatibility(
      reactProfile,
      result.surfaces.ui?.rendererProfile,
    ),
  ).not.toThrow();
  expect(artifact.deliveryUnit.buildMarker).toBe('original');
  expect(artifact.surfaces.ui?.rendererIdentity.buildId).toBe('original');
});

it('keeps API-only artifacts headless when compiler identity is resolved', () => {
  const headlessArtifact = createUltramodernBuildArtifact(deliveryUnit);
  const result = resolveUltramodernBuildArtifact(headlessArtifact, readers);

  expect(Object.hasOwn(result.surfaces, 'ui')).toBe(false);
  expect(result.surfaces.api).toMatchObject({
    build: 'compiled-build',
    buildMarker: 'compiled-build',
    sourceRevision: 'compiled-revision',
  });
  expect(validateUltramodernBuildArtifact(result)).toEqual({
    ok: true,
    errors: [],
  });
});

it.each(nativeProfiles)(
  'preserves the $renderer profile through compiler identity resolution',
  profile => {
    const nativeArtifact = createUltramodernBuildArtifact(deliveryUnit, {
      ui: {
        identity: {
          renderer: profile.renderer,
          appId: deliveryUnit.appId,
          entryName: 'main',
          protocolVersion: 1,
          buildId: deliveryUnit.buildMarker,
        },
        profile,
        routerBindings: controlledRouterBindings(profile),
      },
    });
    const result = resolveUltramodernBuildArtifact(nativeArtifact, readers);

    expect(validateUltramodernBuildArtifact(result).ok).toBe(true);
    expect(result.surfaces.ui?.rendererIdentity.buildId).toBe('compiled-build');
    expect(result.surfaces.ui?.routerBindings).toEqual(
      controlledRouterBindings(profile),
    );
    expect(() =>
      assertRendererProfileCompatibility(
        profile,
        result.surfaces.ui?.rendererProfile,
      ),
    ).not.toThrow();
    expect(() =>
      assertRendererProfileCompatibility(
        reactProfile,
        result.surfaces.ui?.rendererProfile,
      ),
    ).toThrow('cross-renderer components are unsupported');
  },
);

it('rejects obsolete and incompatible renderer metadata at the runtime boundary', () => {
  const obsoleteArtifact = JSON.parse(
    JSON.stringify({ ...artifact, schemaVersion: 1 }),
  );
  expect(() => resolveUltramodernBuildArtifact(obsoleteArtifact)).toThrow(
    'artifact.schemaVersion',
  );

  const incompatibleArtifact = JSON.parse(
    JSON.stringify({
      ...artifact,
      surfaces: {
        ...artifact.surfaces,
        ui: {
          ...artifact.surfaces.ui,
          rendererProfile: { ...reactProfile, renderer: 'solid' },
        },
      },
    }),
  );
  expect(() => resolveUltramodernBuildArtifact(incompatibleArtifact)).toThrow(
    'artifact.surfaces.ui.rendererProfile.renderer',
  );
});

it('falls back only for missing compiler references and preserves each supplied value', () => {
  expect(resolveUltramodernBuildArtifact(artifact)).toEqual(artifact);

  const result = resolveUltramodernBuildArtifact(artifact, {
    buildMarker: readers.buildMarker,
    sourceRevision: () => {
      throw new ReferenceError('ULTRAMODERN_SOURCE_REVISION is not defined');
    },
  });
  expect(result.deliveryUnit.buildMarker).toBe('compiled-build');
  expect(result.deliveryUnit.sourceRevision).toBe('workspace');
  const failure = new Error('reader failed');
  expect(() =>
    resolveUltramodernBuildArtifact(artifact, {
      ...readers,
      buildMarker: () => {
        throw failure;
      },
    }),
  ).toThrow(failure);
});

it('preserves a consistent fallback marker for compiler constants read in another realm', () => {
  const buildMarker: () => string = runInNewContext(
    '() => ULTRAMODERN_BUILD_MARKER',
  );
  const result = resolveUltramodernBuildArtifact(artifact, {
    ...readers,
    buildMarker,
  });

  expect(result.deliveryUnit).toMatchObject({
    build: 'original',
    buildMarker: 'original',
    sourceRevision: 'compiled-revision',
  });
  expect(result.surfaces.api).toMatchObject(result.deliveryUnit);
  expect(result.surfaces.ui).toMatchObject(result.deliveryUnit);
  expect(result.surfaces.ui?.rendererIdentity.buildId).toBe('original');
  expect(validateUltramodernBuildArtifact(result)).toEqual({
    ok: true,
    errors: [],
  });
});

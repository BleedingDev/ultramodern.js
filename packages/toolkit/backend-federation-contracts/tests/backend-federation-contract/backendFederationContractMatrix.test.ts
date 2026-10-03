import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  type BackendFederationContractValidationError,
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
  deliveryUnitContractBlock,
  isUltramodernBuildArtifact,
  type RendererProfile,
  validateBackendFederationManifest,
  validateDeliveryUnitIdentity,
  validateUltramodernBuildArtifact,
} from '../../src/backend-federation-contract';

type MutableRecord = Record<string, unknown>;
const identityFields = ['unitId', 'buildMarker', 'sourceRevision'] as const;

const deliveryUnit: DeliveryUnitRecord = {
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  kind: DELIVERY_UNIT_KIND,
  appId: 'checkout',
  unitId: 'acme/checkout',
  packageName: '@acme/checkout',
  version: '0.1.0',
  buildMarker: 'checkout-build',
  sourceRevision: 'workspace',
  deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
};

const manifestValidationOptions = {
  requireEffectExpose: true,
  requireEffectRuntime: true,
  requireVersionFields: true,
  validateDeliveryUnit: true,
} as const;

const createDeliveryUnit = (): DeliveryUnitRecord => ({ ...deliveryUnit });

// A controlled tuple for schema tests, not installed-package admission evidence.
const controlledReactRouter: RendererProfile['router'] = {
  name: '@tanstack/react-router',
  version: '1.171.15',
  coreName: '@tanstack/router-core',
  coreVersion: '1.171.15',
};

const createReactArtifact = () =>
  createUltramodernBuildArtifact(deliveryUnit, {
    ui: {
      identity: {
        renderer: 'react',
        appId: deliveryUnit.appId,
        entryName: 'main',
        protocolVersion: 1,
        buildId: deliveryUnit.buildMarker,
      },
      profile: {
        renderer: 'react',
        protocolVersion: 1,
        compiler: { name: '@rsbuild/plugin-react', version: '2.1.0' },
        hydration: { name: 'react-dom', version: '19.3.0' },
        router: controlledReactRouter,
      },
      routerBindings: {
        main: {
          owner: '@fixture/react-router-owner',
          evidence: 'file-routes',
          defaultProvider: { framework: 'tanstack', ...controlledReactRouter },
          providers: [{ framework: 'tanstack', ...controlledReactRouter }],
        },
      },
    },
  });

const createIdentityBlock = () => ({
  unitId: deliveryUnit.unitId,
  buildMarker: deliveryUnit.buildMarker,
  sourceRevision: deliveryUnit.sourceRevision,
});

const createValidManifest = () => ({
  schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
  exposes: {
    [BACKEND_FEDERATION_EFFECT_EXPOSE]: './effect-api',
  },
  backendFederation: {
    runtimeFramework: 'effect',
    strictEffectApproach: true,
    contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
    nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
    deliveryUnit: deliveryUnitContractBlock(deliveryUnit),
    versionBoundary: {
      deliveryUnit: createIdentityBlock(),
    },
  },
});

type ValidManifest = ReturnType<typeof createValidManifest>;
type BuildArtifact = ReturnType<typeof createUltramodernBuildArtifact>;

const errorPaths = (
  errors: BackendFederationContractValidationError[],
): string[] => errors.map(error => error.path);

const manifestDeliveryUnit = (manifest: ValidManifest): MutableRecord =>
  manifest.backendFederation.deliveryUnit as unknown as MutableRecord;

const manifestVersionBoundaryDeliveryUnit = (
  manifest: ValidManifest,
): MutableRecord =>
  manifest.backendFederation.versionBoundary
    .deliveryUnit as unknown as MutableRecord;

describe('backend federation contract validation matrix', () => {
  it('accepts a valid backend federation manifest', () => {
    expect(
      validateBackendFederationManifest(
        createValidManifest(),
        manifestValidationOptions,
      ),
    ).toEqual({ ok: true, errors: [] });
  });

  it('accepts identity strings that trim to non-empty values', () => {
    expect(
      validateDeliveryUnitIdentity({
        unitId: ' acme/checkout ',
        buildMarker: '\tcheckout-build\n',
        sourceRevision: ' workspace ',
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it.each(
    identityFields,
  )('rejects a missing delivery-unit identity field %s', field => {
    const candidate = createDeliveryUnit() as unknown as MutableRecord;
    delete candidate[field];

    const result = validateDeliveryUnitIdentity(candidate);

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual([`deliveryUnit.${field}`]);
  });

  it('rejects a non-string delivery-unit identity value', () => {
    const candidate = createDeliveryUnit() as unknown as MutableRecord;
    candidate.unitId = 0;

    const result = validateDeliveryUnitIdentity(candidate);

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual(['deliveryUnit.unitId']);
  });

  it('rejects identity strings that trim to empty', () => {
    const result = validateDeliveryUnitIdentity({
      unitId: '   ',
      buildMarker: 'checkout-build',
      sourceRevision: 'workspace',
    });

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual(['deliveryUnit.unitId']);
  });

  it('rejects a missing manifest delivery-unit identity field', () => {
    const manifest = createValidManifest();
    delete manifestDeliveryUnit(manifest).unitId;

    const result = validateBackendFederationManifest(
      manifest,
      manifestValidationOptions,
    );

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual([
      'manifest.backendFederation.deliveryUnit.unitId',
    ]);
  });

  it('rejects a missing version-boundary identity field', () => {
    const manifest = createValidManifest();
    delete manifestVersionBoundaryDeliveryUnit(manifest).sourceRevision;

    const result = validateBackendFederationManifest(
      manifest,
      manifestValidationOptions,
    );

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual([
      'manifest.backendFederation.versionBoundary.deliveryUnit.sourceRevision',
    ]);
  });

  it.each(
    identityFields,
  )('rejects version-boundary identity mismatch for %s', field => {
    const manifest = createValidManifest();
    manifestVersionBoundaryDeliveryUnit(manifest)[field] = `${String(
      deliveryUnit[field],
    )}-mismatch`;

    const result = validateBackendFederationManifest(
      manifest,
      manifestValidationOptions,
    );

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual([
      `manifest.backendFederation.versionBoundary.deliveryUnit.${field}`,
    ]);
  });

  it('merges metadata expose and compatibility fields during manifest validation', () => {
    const manifest = createValidManifest();
    const metadata = manifest.backendFederation as unknown as MutableRecord;

    delete (manifest as unknown as MutableRecord).exposes;
    delete metadata.contractVersion;
    delete metadata.nodeAdapterVersion;
    metadata.exposes = [{ name: BACKEND_FEDERATION_EFFECT_EXPOSE }];
    metadata.compatibility = {
      contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
    };
    metadata.executionSurfaces = {
      node: { adapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION },
    };

    expect(
      validateBackendFederationManifest(manifest, manifestValidationOptions),
    ).toEqual({ ok: true, errors: [] });
  });

  it('rejects a build artifact without its delivery-unit build alias', () => {
    const artifact = createReactArtifact();
    delete (artifact.deliveryUnit as unknown as MutableRecord).build;

    const result = validateUltramodernBuildArtifact(artifact);

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual(['artifact.deliveryUnit.build']);
  });

  it('rejects a build artifact with a mismatched API build alias', () => {
    const artifact = createReactArtifact();
    artifact.surfaces.api.build = 'different-build';

    const result = validateUltramodernBuildArtifact(artifact);

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual(['artifact.surfaces.api.build']);
  });

  it('rejects ultramodern build artifact surface identity drift', () => {
    const artifact = createReactArtifact();
    expect(validateUltramodernBuildArtifact(artifact).ok).toBe(true);
    expect(isUltramodernBuildArtifact(artifact)).toBe(true);

    const driftedArtifact = {
      ...artifact,
      surfaces: {
        ...artifact.surfaces,
        api: {
          ...artifact.surfaces.api,
          buildMarker: 'different-build',
        },
      },
    } as BuildArtifact;
    const result = validateUltramodernBuildArtifact(driftedArtifact);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      path: 'artifact.surfaces.api.buildMarker',
      message: 'must match artifact.deliveryUnit.buildMarker.',
    });
    expect(isUltramodernBuildArtifact(driftedArtifact)).toBe(false);
  });

  it('accepts the singular metadata expose emitted by backend federation codegen', () => {
    const manifest = createValidManifest();
    const metadata = manifest.backendFederation as unknown as MutableRecord;

    delete (manifest as unknown as MutableRecord).exposes;
    metadata.expose = BACKEND_FEDERATION_EFFECT_EXPOSE;

    expect(
      validateBackendFederationManifest(manifest, manifestValidationOptions),
    ).toEqual({ ok: true, errors: [] });
  });
});

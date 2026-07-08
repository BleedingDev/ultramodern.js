import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  createUltramodernBuildArtifact,
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
  deliveryUnitContractBlock,
  isUltramodernBuildArtifact,
  validateBackendFederationManifest,
  validateDeliveryUnitIdentity,
  validateUltramodernBuildArtifact,
} from '../src/universal/backend-federation-contract';

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

describe('backend federation contract validators', () => {
  it('validates delivery-unit identity fields', () => {
    expect(validateDeliveryUnitIdentity(deliveryUnit).ok).toBe(true);

    const result = validateDeliveryUnitIdentity({
      unitId: 'acme/checkout',
      buildMarker: '',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map(error => error.path)).toEqual([
      'deliveryUnit.buildMarker',
      'deliveryUnit.sourceRevision',
    ]);
  });

  it('rejects blank delivery-unit identity strings', () => {
    const result = validateDeliveryUnitIdentity({
      unitId: '   ',
      buildMarker: 'checkout-build',
      sourceRevision: 'workspace',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.map(error => error.path)).toEqual([
      'deliveryUnit.unitId',
    ]);
  });

  it('validates backend federation manifest metadata and effect expose', () => {
    const result = validateBackendFederationManifest(
      {
        schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
        backendFederation: {
          role: 'microvertical-server',
          name: 'checkoutBackend',
          runtimeFramework: 'effect',
          strictEffectApproach: true,
          contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
          nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
          expose: BACKEND_FEDERATION_EFFECT_EXPOSE,
          deliveryUnit: deliveryUnitContractBlock(deliveryUnit),
          versionBoundary: {
            deliveryUnit: {
              unitId: deliveryUnit.unitId,
              buildMarker: deliveryUnit.buildMarker,
              sourceRevision: deliveryUnit.sourceRevision,
            },
          },
        },
      },
      {
        requireEffectExpose: true,
        requireEffectRuntime: true,
        requireVersionFields: true,
      },
    );

    expect(result).toEqual({ ok: true, errors: [] });

    const missingSourceRevisionResult = validateBackendFederationManifest(
      {
        schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
        backendFederation: {
          role: 'microvertical-server',
          name: 'checkoutBackend',
          runtimeFramework: 'effect',
          strictEffectApproach: true,
          contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
          nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
          expose: BACKEND_FEDERATION_EFFECT_EXPOSE,
          deliveryUnit: deliveryUnitContractBlock(deliveryUnit),
          versionBoundary: {
            deliveryUnit: {
              unitId: deliveryUnit.unitId,
              buildMarker: deliveryUnit.buildMarker,
            },
          },
        },
      },
      {
        requireEffectExpose: true,
        requireEffectRuntime: true,
        requireVersionFields: true,
      },
    );

    expect(missingSourceRevisionResult.ok).toBe(false);
    expect(missingSourceRevisionResult.errors).toContainEqual({
      path: 'manifest.backendFederation.versionBoundary.deliveryUnit.sourceRevision',
      message: 'must be a non-empty string.',
    });
  });

  it('rejects backend federation delivery-unit identity drift', () => {
    const result = validateBackendFederationManifest(
      {
        schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
        backendFederation: {
          role: 'microvertical-server',
          name: 'checkoutBackend',
          runtimeFramework: 'effect',
          strictEffectApproach: true,
          contractVersion: BACKEND_FEDERATION_CONTRACT_VERSION,
          nodeAdapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
          expose: BACKEND_FEDERATION_EFFECT_EXPOSE,
          deliveryUnit: deliveryUnitContractBlock(deliveryUnit),
          versionBoundary: {
            deliveryUnit: {
              unitId: 'acme/checkout-api',
              buildMarker: deliveryUnit.buildMarker,
              sourceRevision: deliveryUnit.sourceRevision,
            },
          },
        },
      },
      {
        requireEffectExpose: true,
        requireEffectRuntime: true,
        requireVersionFields: true,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      path: 'manifest.backendFederation.versionBoundary.deliveryUnit.unitId',
      message: 'must match manifest.backendFederation.deliveryUnit.unitId.',
    });
  });

  it('rejects ultramodern build artifact surface identity drift', () => {
    const artifact = createUltramodernBuildArtifact(deliveryUnit);
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
    };
    const result = validateUltramodernBuildArtifact(driftedArtifact);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      path: 'artifact.surfaces.api.buildMarker',
      message: 'must match artifact.deliveryUnit.buildMarker.',
    });
    expect(isUltramodernBuildArtifact(driftedArtifact)).toBe(false);
  });

  it('rejects ultramodern build artifact surfaces without build aliases', () => {
    const artifact = createUltramodernBuildArtifact(deliveryUnit);
    const missingBuildArtifact = {
      ...artifact,
      surfaces: {
        ...artifact.surfaces,
        api: {
          ...artifact.surfaces.api,
          build: undefined,
        },
      },
    };
    const result = validateUltramodernBuildArtifact(missingBuildArtifact);

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      path: 'artifact.surfaces.api.build',
      message: 'must be non-empty string.',
    });
  });
});

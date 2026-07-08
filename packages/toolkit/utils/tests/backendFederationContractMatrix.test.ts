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
  validateBackendFederationManifest,
  validateDeliveryUnitIdentity,
  validateUltramodernBuildArtifact,
} from '../src/universal/backend-federation-contract';

type MutableRecord = Record<string, unknown>;

const identityFields = ['unitId', 'buildMarker', 'sourceRevision'] as const;
type IdentityField = (typeof identityFields)[number];

type IdentityFieldCase =
  | {
      kind: 'missing';
      label: string;
    }
  | {
      kind: 'value';
      label: string;
      value: unknown;
    };

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

const requiredIdentityFieldCases: IdentityFieldCase[] = [
  {
    kind: 'missing',
    label: 'missing',
  },
  {
    kind: 'value',
    label: 'blank',
    value: '',
  },
  {
    kind: 'value',
    label: 'whitespace',
    value: ' \t\n ',
  },
];

const nonStringIdentityFieldCases: IdentityFieldCase[] = [
  {
    kind: 'value',
    label: 'number zero',
    value: 0,
  },
  {
    kind: 'value',
    label: 'boolean true',
    value: true,
  },
  {
    kind: 'value',
    label: 'array value',
    value: ['checkout'],
  },
  {
    kind: 'value',
    label: 'object value',
    value: { value: 'checkout' },
  },
];

const requiredIdentityFieldMatrix = identityFields.flatMap(field =>
  requiredIdentityFieldCases.map(
    fieldCase => [field, fieldCase.label, fieldCase] as const,
  ),
);

const nonStringIdentityFieldMatrix = identityFields.flatMap(field =>
  nonStringIdentityFieldCases.map(
    fieldCase => [field, fieldCase.label, fieldCase] as const,
  ),
);

const createDeliveryUnit = (): DeliveryUnitRecord => ({ ...deliveryUnit });

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

const applyIdentityFieldCase = (
  target: MutableRecord,
  field: IdentityField,
  fieldCase: IdentityFieldCase,
) => {
  if (fieldCase.kind === 'missing') {
    delete target[field];
    return;
  }

  target[field] = fieldCase.value;
};

const manifestDeliveryUnit = (manifest: ValidManifest): MutableRecord =>
  manifest.backendFederation.deliveryUnit as unknown as MutableRecord;

const manifestVersionBoundaryDeliveryUnit = (
  manifest: ValidManifest,
): MutableRecord =>
  manifest.backendFederation.versionBoundary
    .deliveryUnit as unknown as MutableRecord;

describe('backend federation contract validation matrix', () => {
  it('accepts a valid backend federation manifest', () => {
    const result = validateBackendFederationManifest(
      createValidManifest(),
      manifestValidationOptions,
    );

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('accepts identity strings that trim to non-empty values', () => {
    const result = validateDeliveryUnitIdentity({
      unitId: ' acme/checkout ',
      buildMarker: '\tcheckout-build\n',
      sourceRevision: ' workspace ',
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it.each(
    requiredIdentityFieldMatrix,
  )('rejects delivery-unit identity field %s when %s', (field, _label, fieldCase) => {
    const candidate = createDeliveryUnit() as unknown as MutableRecord;
    applyIdentityFieldCase(candidate, field, fieldCase);

    const result = validateDeliveryUnitIdentity(candidate);

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual([`deliveryUnit.${field}`]);
  });

  it.each(
    nonStringIdentityFieldMatrix,
  )('rejects delivery-unit identity field %s when value is %s', (field, _label, fieldCase) => {
    const candidate = createDeliveryUnit() as unknown as MutableRecord;
    applyIdentityFieldCase(candidate, field, fieldCase);

    const result = validateDeliveryUnitIdentity(candidate);

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual([`deliveryUnit.${field}`]);
  });

  it.each(
    requiredIdentityFieldMatrix,
  )('rejects manifest delivery-unit identity field %s when %s', (field, _label, fieldCase) => {
    const manifest = createValidManifest();
    applyIdentityFieldCase(manifestDeliveryUnit(manifest), field, fieldCase);

    const result = validateBackendFederationManifest(
      manifest,
      manifestValidationOptions,
    );

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual([
      `manifest.backendFederation.deliveryUnit.${field}`,
    ]);
  });

  it.each(
    requiredIdentityFieldMatrix,
  )('rejects version-boundary identity field %s when %s', (field, _label, fieldCase) => {
    const manifest = createValidManifest();
    applyIdentityFieldCase(
      manifestVersionBoundaryDeliveryUnit(manifest),
      field,
      fieldCase,
    );

    const result = validateBackendFederationManifest(
      manifest,
      manifestValidationOptions,
    );

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual([
      `manifest.backendFederation.versionBoundary.deliveryUnit.${field}`,
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
      node: {
        adapterVersion: BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
      },
    };

    const result = validateBackendFederationManifest(
      manifest,
      manifestValidationOptions,
    );

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it.each([
    [
      'missing delivery-unit build',
      (artifact: BuildArtifact) => {
        delete (artifact.deliveryUnit as unknown as MutableRecord).build;
      },
      ['artifact.deliveryUnit.build'],
    ],
    [
      'mismatched delivery-unit build',
      (artifact: BuildArtifact) => {
        artifact.deliveryUnit.build = 'different-build';
      },
      ['artifact.deliveryUnit.build'],
    ],
    [
      'missing api surface build',
      (artifact: BuildArtifact) => {
        delete (artifact.surfaces.api as unknown as MutableRecord).build;
      },
      ['artifact.surfaces.api.build'],
    ],
    [
      'mismatched api surface build',
      (artifact: BuildArtifact) => {
        artifact.surfaces.api.build = 'different-build';
      },
      ['artifact.surfaces.api.build'],
    ],
  ] as const)('rejects build artifact with %s', (_label, mutate, expectedPaths) => {
    const artifact = createUltramodernBuildArtifact(deliveryUnit);

    mutate(artifact);

    const result = validateUltramodernBuildArtifact(artifact);

    expect(result.ok).toBe(false);
    expect(errorPaths(result.errors)).toEqual(expectedPaths);
  });
});

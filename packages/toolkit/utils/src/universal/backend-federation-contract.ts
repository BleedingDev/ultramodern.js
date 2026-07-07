export const BACKEND_FEDERATION_EFFECT_EXPOSE = './effect-api';
export const BACKEND_FEDERATION_MANIFEST_FILE = 'backend-mf-manifest.json';
export const BACKEND_FEDERATION_REMOTE_ENTRY_FILE = 'backendRemoteEntry.mjs';
export const BACKEND_FEDERATION_CONTRACT_VERSION =
  'microvertical-server-effect-v1';
export const BACKEND_FEDERATION_NODE_ADAPTER_VERSION = 'backend-mf-effect-v1';

export const DELIVERY_UNIT_SCHEMA_VERSION = 1;
export const DELIVERY_UNIT_KIND = 'microvertical-delivery-unit';
export const DELIVERY_UNIT_DEPLOY_PROFILE = 'cloudflare-ssr-mf-effect-v1';
export const DELIVERY_UNIT_IDENTITY_FIELDS = [
  'unitId',
  'buildMarker',
  'sourceRevision',
] as const;
export type DeliveryUnitIdentityField =
  (typeof DELIVERY_UNIT_IDENTITY_FIELDS)[number];

export const ULTRAMODERN_BUILD_ARTIFACT_FILE = 'ultramodern-build.json';
export const ULTRAMODERN_BUILD_ARTIFACT_PATH = `shared/${ULTRAMODERN_BUILD_ARTIFACT_FILE}`;
export const ULTRAMODERN_BUILD_MODULE_FILE = 'ultramodern-build.ts';
export const ULTRAMODERN_BUILD_MODULE_PATH = `shared/${ULTRAMODERN_BUILD_MODULE_FILE}`;

export type DeliveryUnitIdentity = {
  unitId: string;
  buildMarker: string;
  sourceRevision: string;
};

export type DeliveryUnitRecord = DeliveryUnitIdentity & {
  schemaVersion: typeof DELIVERY_UNIT_SCHEMA_VERSION;
  kind: typeof DELIVERY_UNIT_KIND;
  appId: string;
  packageName: string;
  version: string;
  deployProfile: typeof DELIVERY_UNIT_DEPLOY_PROFILE;
};

export type DeliveryUnitContractBlock = Omit<
  DeliveryUnitRecord,
  'appId' | 'deployProfile'
>;

export type UltramodernBuildDeliveryUnit = DeliveryUnitRecord & {
  build: string;
};

export type UltramodernBuildSurface =
  | (UltramodernBuildDeliveryUnit & { surface: 'ui' })
  | (UltramodernBuildDeliveryUnit & { surface: 'api' });

export type UltramodernBuildArtifact = {
  schemaVersion: typeof DELIVERY_UNIT_SCHEMA_VERSION;
  kind: 'ultramodern-build-artifact';
  deliveryUnit: UltramodernBuildDeliveryUnit;
  surfaces: {
    ui: UltramodernBuildDeliveryUnit & { surface: 'ui' };
    api: UltramodernBuildDeliveryUnit & { surface: 'api' };
  };
};

export type BackendFederationContractValidationError = {
  path: string;
  message: string;
};

export type BackendFederationContractValidationResult = {
  ok: boolean;
  errors: BackendFederationContractValidationError[];
};

export type ValidateDeliveryUnitIdentityOptions = {
  path?: string;
  allowBuildAlias?: boolean;
};

export type ValidateBackendFederationMetadataOptions = {
  path?: string;
  expectedContractVersion?: string | false;
  expectedNodeAdapterVersion?: string | false;
  validateDeliveryUnit?: boolean;
  requireEffectExpose?: boolean;
  requireEffectRuntime?: boolean;
  requireVersionFields?: boolean;
};

export type ValidateBackendFederationManifestOptions =
  ValidateBackendFederationMetadataOptions & {
    requireBackendFederation?: boolean;
  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const validationResult = (
  errors: BackendFederationContractValidationError[],
): BackendFederationContractValidationResult => ({
  ok: errors.length === 0,
  errors,
});

const addError = (
  errors: BackendFederationContractValidationError[],
  path: string,
  message: string,
) => {
  errors.push({ path, message });
};

const recordField = (
  value: Record<string, unknown> | undefined,
  field: string,
) => {
  const fieldValue = value?.[field];
  return isRecord(fieldValue) ? fieldValue : undefined;
};

export const formatBackendFederationValidationErrors = (
  errors: BackendFederationContractValidationError[],
): string => errors.map(error => `${error.path}: ${error.message}`).join('; ');

export const deliveryUnitIdentityFieldValue = (
  value: unknown,
  field: DeliveryUnitIdentityField,
  options: Pick<ValidateDeliveryUnitIdentityOptions, 'allowBuildAlias'> = {},
): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (field === 'buildMarker' && options.allowBuildAlias) {
    return nonEmptyString(value.buildMarker) ?? nonEmptyString(value.build);
  }

  return nonEmptyString(value[field]);
};

export const validateDeliveryUnitIdentity = (
  value: unknown,
  options: ValidateDeliveryUnitIdentityOptions = {},
): BackendFederationContractValidationResult => {
  const path = options.path ?? 'deliveryUnit';
  const errors: BackendFederationContractValidationError[] = [];

  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return validationResult(errors);
  }

  for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
    if (!deliveryUnitIdentityFieldValue(value, field, options)) {
      addError(errors, `${path}.${field}`, 'must be a non-empty string.');
    }
  }

  return validationResult(errors);
};

export const validateDeliveryUnitContractBlock = (
  value: unknown,
  options: ValidateDeliveryUnitIdentityOptions = {},
): BackendFederationContractValidationResult => {
  const path = options.path ?? 'deliveryUnit';
  const errors = [...validateDeliveryUnitIdentity(value, options).errors];

  if (!isRecord(value)) {
    return validationResult(errors);
  }

  if (value.schemaVersion !== DELIVERY_UNIT_SCHEMA_VERSION) {
    addError(
      errors,
      `${path}.schemaVersion`,
      `must be ${DELIVERY_UNIT_SCHEMA_VERSION}.`,
    );
  }
  if (value.kind !== DELIVERY_UNIT_KIND) {
    addError(errors, `${path}.kind`, `must be "${DELIVERY_UNIT_KIND}".`);
  }
  if (!nonEmptyString(value.packageName)) {
    addError(errors, `${path}.packageName`, 'must be a non-empty string.');
  }
  if (!nonEmptyString(value.version)) {
    addError(errors, `${path}.version`, 'must be a non-empty string.');
  }

  return validationResult(errors);
};

export const validateDeliveryUnitRecord = (
  value: unknown,
  options: ValidateDeliveryUnitIdentityOptions = {},
): BackendFederationContractValidationResult => {
  const path = options.path ?? 'deliveryUnit';
  const errors = [
    ...validateDeliveryUnitContractBlock(value, {
      ...options,
      path,
    }).errors,
  ];

  if (!isRecord(value)) {
    return validationResult(errors);
  }

  if (!nonEmptyString(value.appId)) {
    addError(errors, `${path}.appId`, 'must be a non-empty string.');
  }
  if (value.deployProfile !== DELIVERY_UNIT_DEPLOY_PROFILE) {
    addError(
      errors,
      `${path}.deployProfile`,
      `must be "${DELIVERY_UNIT_DEPLOY_PROFILE}".`,
    );
  }

  return validationResult(errors);
};

const validateDeliveryUnitBoundaryIdentity = (
  value: unknown,
  path: string,
): BackendFederationContractValidationError[] => {
  const errors: BackendFederationContractValidationError[] = [];

  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return errors;
  }

  if (!nonEmptyString(value.unitId)) {
    addError(errors, `${path}.unitId`, 'must be a non-empty string.');
  }
  if (!nonEmptyString(value.buildMarker)) {
    addError(errors, `${path}.buildMarker`, 'must be a non-empty string.');
  }

  return errors;
};

export const deliveryUnitContractBlock = (
  record: DeliveryUnitRecord,
): DeliveryUnitContractBlock => ({
  schemaVersion: record.schemaVersion,
  kind: record.kind,
  unitId: record.unitId,
  packageName: record.packageName,
  version: record.version,
  buildMarker: record.buildMarker,
  sourceRevision: record.sourceRevision,
});

export const toDeliveryUnitIdentity = (
  value: unknown,
): DeliveryUnitIdentity | undefined => {
  const unitId = deliveryUnitIdentityFieldValue(value, 'unitId');
  const buildMarker = deliveryUnitIdentityFieldValue(value, 'buildMarker', {
    allowBuildAlias: true,
  });
  const sourceRevision = deliveryUnitIdentityFieldValue(
    value,
    'sourceRevision',
  );

  if (!unitId || !buildMarker || !sourceRevision) {
    return undefined;
  }

  return { unitId, buildMarker, sourceRevision };
};

export const toBackendFederationExposeNames = (value: unknown): string[] => {
  const names: string[] = [];

  if (Array.isArray(value)) {
    for (const expose of value) {
      const name =
        nonEmptyString(expose) ??
        (isRecord(expose) ? nonEmptyString(expose.name) : undefined);
      if (name) {
        names.push(name);
      }
    }
  } else if (isRecord(value)) {
    names.push(...Object.keys(value).filter(name => name.length > 0));
  }

  return Array.from(new Set(names));
};

export const backendFederationExposeNames = (value: unknown): string[] => {
  if (!isRecord(value)) {
    return [];
  }

  const exposes = toBackendFederationExposeNames(value.exposes);
  const expose = nonEmptyString(value.expose);
  return Array.from(new Set([...exposes, ...(expose ? [expose] : [])]));
};

export const backendFederationMetadata = (
  value: unknown,
): Record<string, unknown> | undefined =>
  isRecord(value) ? recordField(value, 'backendFederation') : undefined;

export const backendFederationVersionBoundary = (
  value: unknown,
): Record<string, unknown> | undefined =>
  recordField(backendFederationMetadata(value), 'versionBoundary');

const validateVersionField = (
  errors: BackendFederationContractValidationError[],
  record: Record<string, unknown>,
  field: 'contractVersion' | 'nodeAdapterVersion',
  expected: string | false,
  path: string,
  required: boolean,
) => {
  const compatibility = recordField(record, 'compatibility');
  const executionSurfaces = recordField(record, 'executionSurfaces');
  const nodeSurface = recordField(executionSurfaces, 'node');
  const actual =
    nonEmptyString(record[field]) ??
    nonEmptyString(compatibility?.[field]) ??
    (field === 'nodeAdapterVersion'
      ? nonEmptyString(nodeSurface?.adapterVersion)
      : undefined);

  if (!actual) {
    if (required) {
      addError(errors, `${path}.${field}`, 'must be a non-empty string.');
    }
    return;
  }

  if (expected !== false && actual !== expected) {
    addError(errors, `${path}.${field}`, `must be "${expected}".`);
  }
};

export const validateBackendFederationMetadata = (
  value: unknown,
  options: ValidateBackendFederationMetadataOptions = {},
): BackendFederationContractValidationResult => {
  const path = options.path ?? 'backendFederation';
  const errors: BackendFederationContractValidationError[] = [];

  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return validationResult(errors);
  }

  if (options.requireEffectRuntime && value.runtimeFramework !== 'effect') {
    addError(errors, `${path}.runtimeFramework`, 'must be "effect".');
  }
  if (options.requireEffectRuntime && value.strictEffectApproach !== true) {
    addError(errors, `${path}.strictEffectApproach`, 'must be true.');
  }

  validateVersionField(
    errors,
    value,
    'contractVersion',
    options.expectedContractVersion ?? BACKEND_FEDERATION_CONTRACT_VERSION,
    path,
    options.requireVersionFields ?? false,
  );
  validateVersionField(
    errors,
    value,
    'nodeAdapterVersion',
    options.expectedNodeAdapterVersion ??
      BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
    path,
    options.requireVersionFields ?? false,
  );

  if (
    options.requireEffectExpose &&
    !backendFederationExposeNames(value).includes(
      BACKEND_FEDERATION_EFFECT_EXPOSE,
    )
  ) {
    addError(
      errors,
      `${path}.expose`,
      `must include "${BACKEND_FEDERATION_EFFECT_EXPOSE}".`,
    );
  }

  if (options.validateDeliveryUnit ?? true) {
    const deliveryUnit = recordField(value, 'deliveryUnit');
    if (deliveryUnit) {
      errors.push(
        ...validateDeliveryUnitContractBlock(deliveryUnit, {
          path: `${path}.deliveryUnit`,
        }).errors,
      );
    }

    const versionBoundary = recordField(value, 'versionBoundary');
    const versionBoundaryDeliveryUnit = recordField(
      versionBoundary,
      'deliveryUnit',
    );
    if (versionBoundaryDeliveryUnit) {
      errors.push(
        ...validateDeliveryUnitBoundaryIdentity(
          versionBoundaryDeliveryUnit,
          `${path}.versionBoundary.deliveryUnit`,
        ),
      );
    }
  }

  return validationResult(errors);
};

export const validateBackendFederationManifest = (
  value: unknown,
  options: ValidateBackendFederationManifestOptions = {},
): BackendFederationContractValidationResult => {
  const path = options.path ?? 'manifest';
  const errors: BackendFederationContractValidationError[] = [];

  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return validationResult(errors);
  }

  if (
    value.schemaVersion !== undefined &&
    value.schemaVersion !== DELIVERY_UNIT_SCHEMA_VERSION
  ) {
    addError(
      errors,
      `${path}.schemaVersion`,
      `must be ${DELIVERY_UNIT_SCHEMA_VERSION}.`,
    );
  }

  const metadata = backendFederationMetadata(value);
  if (!metadata) {
    if (options.requireBackendFederation ?? true) {
      addError(errors, `${path}.backendFederation`, 'must be an object.');
    }
  } else {
    errors.push(
      ...validateBackendFederationMetadata(metadata, {
        ...options,
        path: `${path}.backendFederation`,
        requireEffectExpose: false,
      }).errors,
    );
  }

  if (options.requireEffectExpose) {
    const topLevelExposeNames = toBackendFederationExposeNames(value.exposes);
    const metadataExposeNames = backendFederationExposeNames(metadata);
    const exposeNames = new Set([
      ...topLevelExposeNames,
      ...metadataExposeNames,
    ]);
    if (!exposeNames.has(BACKEND_FEDERATION_EFFECT_EXPOSE)) {
      addError(
        errors,
        `${path}.exposes`,
        `must include "${BACKEND_FEDERATION_EFFECT_EXPOSE}".`,
      );
    }
  }

  return validationResult(errors);
};

export const createUltramodernBuildArtifact = (
  record: DeliveryUnitRecord,
): UltramodernBuildArtifact => {
  const deliveryUnit = {
    ...record,
    build: record.buildMarker,
  };

  return {
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    kind: 'ultramodern-build-artifact',
    deliveryUnit,
    surfaces: {
      ui: { ...deliveryUnit, surface: 'ui' },
      api: { ...deliveryUnit, surface: 'api' },
    },
  };
};

export const validateUltramodernBuildArtifact = (
  value: unknown,
  path = 'artifact',
): BackendFederationContractValidationResult => {
  const errors: BackendFederationContractValidationError[] = [];

  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return validationResult(errors);
  }

  if (value.schemaVersion !== DELIVERY_UNIT_SCHEMA_VERSION) {
    addError(
      errors,
      `${path}.schemaVersion`,
      `must be ${DELIVERY_UNIT_SCHEMA_VERSION}.`,
    );
  }
  if (value.kind !== 'ultramodern-build-artifact') {
    addError(errors, `${path}.kind`, 'must be "ultramodern-build-artifact".');
  }

  const deliveryUnit = value.deliveryUnit;
  errors.push(
    ...validateDeliveryUnitRecord(deliveryUnit, {
      path: `${path}.deliveryUnit`,
      allowBuildAlias: true,
    }).errors,
  );

  if (isRecord(deliveryUnit)) {
    const build = nonEmptyString(deliveryUnit.build);
    const buildMarker = nonEmptyString(deliveryUnit.buildMarker);
    if (!build) {
      addError(
        errors,
        `${path}.deliveryUnit.build`,
        'must be a non-empty string.',
      );
    } else if (buildMarker && build !== buildMarker) {
      addError(
        errors,
        `${path}.deliveryUnit.build`,
        'must match deliveryUnit.buildMarker.',
      );
    }
  }

  const surfaces = recordField(value, 'surfaces');
  if (!surfaces) {
    addError(errors, `${path}.surfaces`, 'must be an object.');
    return validationResult(errors);
  }

  for (const surface of ['ui', 'api'] as const) {
    const marker = surfaces[surface];
    const markerPath = `${path}.surfaces.${surface}`;
    errors.push(
      ...validateDeliveryUnitRecord(marker, {
        path: markerPath,
        allowBuildAlias: true,
      }).errors,
    );

    if (!isRecord(marker)) {
      continue;
    }

    if (marker.surface !== surface) {
      addError(errors, `${markerPath}.surface`, `must be "${surface}".`);
    }

    for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
      const deliveryUnitValue = deliveryUnitIdentityFieldValue(
        deliveryUnit,
        field,
        { allowBuildAlias: true },
      );
      const markerValue = deliveryUnitIdentityFieldValue(marker, field, {
        allowBuildAlias: true,
      });
      if (
        deliveryUnitValue !== undefined &&
        markerValue !== undefined &&
        deliveryUnitValue !== markerValue
      ) {
        addError(
          errors,
          `${markerPath}.${field}`,
          `must match ${path}.deliveryUnit.${field}.`,
        );
      }
    }
  }

  return validationResult(errors);
};

export const isUltramodernBuildArtifact = (
  value: unknown,
): value is UltramodernBuildArtifact =>
  validateUltramodernBuildArtifact(value).ok;

export const stampUltramodernBuildArtifactSourceRevision = (
  artifact: UltramodernBuildArtifact,
  sourceRevision: string,
): UltramodernBuildArtifact => ({
  ...artifact,
  deliveryUnit: {
    ...artifact.deliveryUnit,
    sourceRevision,
  },
  surfaces: {
    ui: {
      ...artifact.surfaces.ui,
      sourceRevision,
    },
    api: {
      ...artifact.surfaces.api,
      sourceRevision,
    },
  },
});

export const BACKEND_FEDERATION_EFFECT_EXPOSE = './effect-api';
export const BACKEND_FEDERATION_MANIFEST_FILE = 'backend-mf-manifest.json';
export const BACKEND_FEDERATION_REMOTE_ENTRY_FILE = 'backendRemoteEntry.mjs';
export const BACKEND_FEDERATION_CONTRACT_VERSION =
  'microvertical-server-effect-v1';
export const BACKEND_FEDERATION_NODE_ADAPTER_VERSION = 'backend-mf-effect-v1';

export const DELIVERY_UNIT_SCHEMA_VERSION = 1;
export const DELIVERY_UNIT_KIND = 'microvertical-delivery-unit';
export const DELIVERY_UNIT_DEPLOY_PROFILE = 'cloudflare-ssr-mf-effect-v1';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

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
  if (!isRecord(value)) {
    return undefined;
  }

  const unitId = nonEmptyString(value.unitId);
  const buildMarker =
    nonEmptyString(value.buildMarker) ?? nonEmptyString(value.build);
  const sourceRevision = nonEmptyString(value.sourceRevision);

  if (!unitId || !buildMarker || !sourceRevision) {
    return undefined;
  }

  return { unitId, buildMarker, sourceRevision };
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

export const isUltramodernBuildArtifact = (
  value: unknown,
): value is UltramodernBuildArtifact => {
  if (!isRecord(value)) {
    return false;
  }

  const deliveryUnit = value.deliveryUnit;
  const surfaces = value.surfaces;

  return (
    value.schemaVersion === DELIVERY_UNIT_SCHEMA_VERSION &&
    value.kind === 'ultramodern-build-artifact' &&
    toDeliveryUnitIdentity(deliveryUnit) !== undefined &&
    isRecord(deliveryUnit) &&
    deliveryUnit.kind === DELIVERY_UNIT_KIND &&
    isRecord(surfaces) &&
    toDeliveryUnitIdentity(surfaces.ui) !== undefined &&
    toDeliveryUnitIdentity(surfaces.api) !== undefined
  );
};

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

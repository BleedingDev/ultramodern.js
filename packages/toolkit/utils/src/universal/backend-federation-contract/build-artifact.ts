import {
  DELIVERY_UNIT_IDENTITY_FIELDS,
  DELIVERY_UNIT_SCHEMA_VERSION,
} from './constants';
import {
  deliveryUnitIdentityFieldValue,
  validateDeliveryUnitRecord,
} from './delivery-unit';
import type {
  BackendFederationContractValidationError,
  BackendFederationContractValidationResult,
  DeliveryUnitRecord,
  UltramodernBuildArtifact,
} from './types';
import {
  addError,
  isRecord,
  nonEmptyString,
  recordField,
  validationResult,
} from './validation-core';

export const createUltramodernBuildArtifact = (
  record: DeliveryUnitRecord,
): UltramodernBuildArtifact => {
  const deliveryUnit = {
    appId: record.appId,
    build: record.buildMarker,
    buildMarker: record.buildMarker,
    deployProfile: record.deployProfile,
    kind: record.kind,
    packageName: record.packageName,
    schemaVersion: record.schemaVersion,
    sourceRevision: record.sourceRevision,
    unitId: record.unitId,
    version: record.version,
  };
  const api = {
    appId: deliveryUnit.appId,
    build: deliveryUnit.build,
    buildMarker: deliveryUnit.buildMarker,
    deployProfile: deliveryUnit.deployProfile,
    kind: deliveryUnit.kind,
    packageName: deliveryUnit.packageName,
    schemaVersion: deliveryUnit.schemaVersion,
    sourceRevision: deliveryUnit.sourceRevision,
    surface: 'api' as const,
    unitId: deliveryUnit.unitId,
    version: deliveryUnit.version,
  };
  const ui = {
    appId: deliveryUnit.appId,
    build: deliveryUnit.build,
    buildMarker: deliveryUnit.buildMarker,
    deployProfile: deliveryUnit.deployProfile,
    kind: deliveryUnit.kind,
    packageName: deliveryUnit.packageName,
    schemaVersion: deliveryUnit.schemaVersion,
    sourceRevision: deliveryUnit.sourceRevision,
    surface: 'ui' as const,
    unitId: deliveryUnit.unitId,
    version: deliveryUnit.version,
  };

  return {
    deliveryUnit,
    kind: 'ultramodern-build-artifact',
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    surfaces: {
      api,
      ui,
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

    const markerBuild = nonEmptyString(marker.build);
    const markerBuildMarker = nonEmptyString(marker.buildMarker);
    if (!markerBuild) {
      addError(errors, `${markerPath}.build`, 'must be non-empty string.');
    } else if (markerBuildMarker && markerBuild !== markerBuildMarker) {
      addError(errors, `${markerPath}.build`, 'must match buildMarker.');
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

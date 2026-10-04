import {
  DELIVERY_UNIT_IDENTITY_FIELDS,
  ULTRAMODERN_BUILD_ARTIFACT_SCHEMA_VERSION,
} from './constants';
import {
  deliveryUnitIdentityFieldValue,
  validateDeliveryUnitRecord,
} from './delivery-unit';
import {
  type RendererProfile,
  validateRendererIdentity,
  validateRendererProfile,
} from './renderer-profile';
import {
  immutableRendererRouterBindings,
  validateRendererRouterBindings,
} from './renderer-router-bindings';
import type {
  BackendFederationContractValidationError,
  BackendFederationContractValidationResult,
  CreateUltramodernBuildArtifactOptions,
  DeliveryUnitRecord,
  UltramodernBuildArtifact,
} from './types';
import {
  addError,
  formatBackendFederationValidationErrors,
  isRecord,
  nonEmptyString,
  recordField,
  validationResult,
} from './validation-core';

const immutableRendererProfile = (profile: RendererProfile): RendererProfile =>
  Object.freeze({
    ...profile,
    compiler: Object.freeze({ ...profile.compiler }),
    hydration: Object.freeze({ ...profile.hydration }),
    router: Object.freeze({ ...profile.router }),
  });

const validateUiRouterBindings = (
  ui: { routerBindings?: unknown },
  primaryEntryName: unknown,
  path: string,
): BackendFederationContractValidationResult => {
  const errors: BackendFederationContractValidationError[] = [];
  if (!Object.hasOwn(ui, 'routerBindings')) {
    addError(errors, path, 'is required on the UI surface.');
    return validationResult(errors);
  }
  const bindings = ui.routerBindings;
  errors.push(
    ...validateRendererRouterBindings(
      bindings,
      isRecord(bindings) ? Object.keys(bindings) : [],
      path,
    ).errors,
  );
  if (
    typeof primaryEntryName === 'string' &&
    (!isRecord(bindings) || !Object.hasOwn(bindings, primaryEntryName))
  ) {
    addError(errors, path, 'must include the primary renderer entry.');
  }
  return validationResult(errors);
};

export const createUltramodernBuildArtifact = (
  record: DeliveryUnitRecord,
  options: CreateUltramodernBuildArtifactOptions = {},
): UltramodernBuildArtifact => {
  if (Object.hasOwn(options, 'ui')) {
    if (!options.ui) {
      throw new Error(
        'artifact.ui must contain an explicit identity and profile.',
      );
    }
    const errors = [
      ...validateRendererIdentity(options.ui.identity, 'artifact.ui.identity')
        .errors,
      ...validateRendererProfile(options.ui.profile, 'artifact.ui.profile')
        .errors,
      ...validateUiRouterBindings(
        options.ui,
        isRecord(options.ui.identity)
          ? options.ui.identity.entryName
          : undefined,
        'artifact.ui.routerBindings',
      ).errors,
    ];
    if (errors.length) {
      throw new Error(formatBackendFederationValidationErrors(errors));
    }
  }
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

  const artifact: UltramodernBuildArtifact = {
    deliveryUnit,
    kind: 'ultramodern-build-artifact',
    schemaVersion: ULTRAMODERN_BUILD_ARTIFACT_SCHEMA_VERSION,
    surfaces: {
      api: { ...deliveryUnit, surface: 'api' },
      ...(options.ui
        ? {
            ui: {
              ...deliveryUnit,
              surface: 'ui' as const,
              rendererIdentity: Object.freeze({ ...options.ui.identity }),
              rendererProfile: immutableRendererProfile(options.ui.profile),
              routerBindings: immutableRendererRouterBindings(
                options.ui.routerBindings,
              ),
            },
          }
        : {}),
    },
  };
  assertUltramodernBuildArtifact(artifact);
  return artifact;
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

  for (const field of Object.keys(value)) {
    if (
      !['schemaVersion', 'kind', 'deliveryUnit', 'surfaces'].includes(field)
    ) {
      addError(errors, `${path}.${field}`, 'is not a supported field.');
    }
  }

  if (value.schemaVersion !== ULTRAMODERN_BUILD_ARTIFACT_SCHEMA_VERSION) {
    addError(
      errors,
      `${path}.schemaVersion`,
      `must be ${ULTRAMODERN_BUILD_ARTIFACT_SCHEMA_VERSION}.`,
    );
  }
  if (value.kind !== 'ultramodern-build-artifact') {
    addError(errors, `${path}.kind`, 'must be "ultramodern-build-artifact".');
  }

  const deliveryUnit = value.deliveryUnit;
  errors.push(
    ...validateDeliveryUnitRecord(deliveryUnit, {
      path: `${path}.deliveryUnit`,
    }).errors,
  );

  if (isRecord(deliveryUnit)) {
    for (const field of [
      'rendererIdentity',
      'rendererProfile',
      'routerBindings',
    ]) {
      if (Object.hasOwn(deliveryUnit, field)) {
        addError(
          errors,
          `${path}.deliveryUnit.${field}`,
          'is only allowed on the UI surface.',
        );
      }
    }
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

  for (const surface of Object.keys(surfaces)) {
    if (surface !== 'api' && surface !== 'ui') {
      addError(
        errors,
        `${path}.surfaces.${surface}`,
        'is not a supported surface.',
      );
    }
  }

  for (const surface of ['ui', 'api'] as const) {
    if (surface === 'ui' && !Object.hasOwn(surfaces, 'ui')) {
      continue;
    }
    const marker = surfaces[surface];
    const markerPath = `${path}.surfaces.${surface}`;
    errors.push(
      ...validateDeliveryUnitRecord(marker, {
        path: markerPath,
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

    if (surface === 'api') {
      for (const field of [
        'rendererIdentity',
        'rendererProfile',
        'routerBindings',
      ]) {
        if (Object.hasOwn(marker, field)) {
          addError(
            errors,
            `${markerPath}.${field}`,
            'is forbidden on the API surface.',
          );
        }
      }
    } else {
      errors.push(
        ...validateRendererIdentity(
          marker.rendererIdentity,
          `${markerPath}.rendererIdentity`,
        ).errors,
        ...validateRendererProfile(
          marker.rendererProfile,
          `${markerPath}.rendererProfile`,
        ).errors,
      );
      const rendererIdentity = recordField(marker, 'rendererIdentity');
      const rendererProfile = recordField(marker, 'rendererProfile');
      errors.push(
        ...validateUiRouterBindings(
          marker,
          rendererIdentity?.entryName,
          `${markerPath}.routerBindings`,
        ).errors,
      );
      if (rendererIdentity) {
        if (rendererIdentity.appId !== marker.appId) {
          addError(
            errors,
            `${markerPath}.rendererIdentity.appId`,
            'must match the UI delivery-unit appId.',
          );
        }
        if (rendererIdentity.buildId !== marker.buildMarker) {
          addError(
            errors,
            `${markerPath}.rendererIdentity.buildId`,
            'must match the UI delivery-unit buildMarker.',
          );
        }
      }
      if (rendererIdentity && rendererProfile) {
        for (const field of ['renderer', 'protocolVersion']) {
          if (rendererIdentity[field] !== rendererProfile[field]) {
            addError(
              errors,
              `${markerPath}.rendererProfile.${field}`,
              'must match the renderer identity.',
            );
          }
        }
      }
    }

    for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
      const deliveryUnitValue = deliveryUnitIdentityFieldValue(
        deliveryUnit,
        field,
      );
      const markerValue = deliveryUnitIdentityFieldValue(marker, field);
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
    if (isRecord(deliveryUnit)) {
      for (const field of [
        'appId',
        'packageName',
        'version',
        'deployProfile',
        'schemaVersion',
        'kind',
      ]) {
        if (marker[field] !== deliveryUnit[field]) {
          addError(
            errors,
            `${markerPath}.${field}`,
            `must match ${path}.deliveryUnit.${field}.`,
          );
        }
      }
    }
  }

  return validationResult(errors);
};

export const isUltramodernBuildArtifact = (
  value: unknown,
): value is UltramodernBuildArtifact =>
  validateUltramodernBuildArtifact(value).ok;

export function assertUltramodernBuildArtifact(
  value: unknown,
  path = 'artifact',
): asserts value is UltramodernBuildArtifact {
  const result = validateUltramodernBuildArtifact(value, path);
  if (!result.ok) {
    throw new Error(formatBackendFederationValidationErrors(result.errors));
  }
}

export const stampUltramodernBuildArtifactIdentity = (
  artifact: UltramodernBuildArtifact,
  identity: {
    buildMarker: string;
    sourceRevision: string;
  },
): UltramodernBuildArtifact => {
  assertUltramodernBuildArtifact(artifact);
  const stamped = {
    build: identity.buildMarker,
    buildMarker: identity.buildMarker,
    sourceRevision: identity.sourceRevision,
  };
  const stamp = <T>(value: T) => ({ ...value, ...stamped });
  const result: UltramodernBuildArtifact = {
    ...artifact,
    deliveryUnit: stamp(artifact.deliveryUnit),
    surfaces: {
      api: stamp(artifact.surfaces.api),
      ...(artifact.surfaces.ui
        ? {
            ui: {
              ...stamp(artifact.surfaces.ui),
              rendererIdentity: Object.freeze({
                ...artifact.surfaces.ui.rendererIdentity,
                buildId: identity.buildMarker,
              }),
              rendererProfile: immutableRendererProfile(
                artifact.surfaces.ui.rendererProfile,
              ),
              routerBindings: immutableRendererRouterBindings(
                artifact.surfaces.ui.routerBindings,
              ),
            },
          }
        : {}),
    },
  };
  assertUltramodernBuildArtifact(result);
  return result;
};

export const stampUltramodernBuildArtifactSourceRevision = (
  artifact: UltramodernBuildArtifact,
  sourceRevision: string,
): UltramodernBuildArtifact =>
  stampUltramodernBuildArtifactIdentity(artifact, {
    buildMarker: artifact.deliveryUnit.buildMarker,
    sourceRevision,
  });

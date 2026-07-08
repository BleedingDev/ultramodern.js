import {
  BACKEND_FEDERATION_CONTRACT_VERSION,
  BACKEND_FEDERATION_EFFECT_EXPOSE,
  BACKEND_FEDERATION_NODE_ADAPTER_VERSION,
  DELIVERY_UNIT_IDENTITY_FIELDS,
  DELIVERY_UNIT_SCHEMA_VERSION,
} from './constants';
import {
  deliveryUnitIdentityFieldValue,
  validateDeliveryUnitBoundaryIdentity,
  validateDeliveryUnitContractBlock,
} from './delivery-unit';
import type {
  BackendFederationContractValidationError,
  BackendFederationContractValidationResult,
  ValidateBackendFederationManifestOptions,
  ValidateBackendFederationMetadataOptions,
} from './types';
import {
  addError,
  isRecord,
  nonEmptyString,
  recordField,
  validateVersionField,
  validationResult,
} from './validation-core';

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

    if (deliveryUnit && versionBoundaryDeliveryUnit) {
      for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
        const deliveryUnitValue = deliveryUnitIdentityFieldValue(
          deliveryUnit,
          field,
        );
        const versionBoundaryDeliveryUnitValue = deliveryUnitIdentityFieldValue(
          versionBoundaryDeliveryUnit,
          field,
        );

        if (
          deliveryUnitValue &&
          versionBoundaryDeliveryUnitValue &&
          deliveryUnitValue !== versionBoundaryDeliveryUnitValue
        ) {
          addError(
            errors,
            `${path}.versionBoundary.deliveryUnit.${field}`,
            `must match ${path}.deliveryUnit.${field}.`,
          );
        }
      }
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

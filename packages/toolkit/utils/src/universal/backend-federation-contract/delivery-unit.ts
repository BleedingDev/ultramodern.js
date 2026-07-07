import type { DeliveryUnitIdentityField } from './constants';
import {
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_IDENTITY_FIELDS,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
} from './constants';
import type {
  BackendFederationContractValidationError,
  BackendFederationContractValidationResult,
  DeliveryUnitContractBlock,
  DeliveryUnitIdentity,
  DeliveryUnitRecord,
  ValidateDeliveryUnitIdentityOptions,
} from './types';
import {
  addError,
  isRecord,
  nonEmptyString,
  validationResult,
} from './validation-core';

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

export const validateDeliveryUnitBoundaryIdentity = (
  value: unknown,
  path: string,
): BackendFederationContractValidationError[] => {
  const errors: BackendFederationContractValidationError[] = [];

  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return errors;
  }

  for (const field of DELIVERY_UNIT_IDENTITY_FIELDS) {
    if (!deliveryUnitIdentityFieldValue(value, field)) {
      addError(errors, `${path}.${field}`, 'must be a non-empty string.');
    }
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

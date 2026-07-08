import type {
  BackendFederationContractValidationError,
  BackendFederationContractValidationResult,
} from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined;

export const validationResult = (
  errors: BackendFederationContractValidationError[],
): BackendFederationContractValidationResult => ({
  ok: errors.length === 0,
  errors,
});

export const addError = (
  errors: BackendFederationContractValidationError[],
  path: string,
  message: string,
) => {
  errors.push({ path, message });
};

export const recordField = (
  value: Record<string, unknown> | undefined,
  field: string,
) => {
  const fieldValue = value?.[field];
  return isRecord(fieldValue) ? fieldValue : undefined;
};

export const formatBackendFederationValidationErrors = (
  errors: BackendFederationContractValidationError[],
): string => errors.map(error => `${error.path}: ${error.message}`).join('; ');

export const validateVersionField = (
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

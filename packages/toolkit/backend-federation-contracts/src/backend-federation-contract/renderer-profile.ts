import type {
  BackendFederationContractValidationError,
  BackendFederationContractValidationResult,
} from './types';
import {
  addError,
  formatBackendFederationValidationErrors,
  isRecord,
  validationResult,
} from './validation-core';

export const RENDERER_PROTOCOL_VERSION = 1;
export const RENDERERS = ['react', 'solid', 'octane'] as const;
export type RendererName = (typeof RENDERERS)[number];

export type RendererIdentity = Readonly<{
  renderer: RendererName;
  appId: string;
  entryName: string;
  protocolVersion: typeof RENDERER_PROTOCOL_VERSION;
  buildId: string;
}>;

export type RendererPackageIdentity = Readonly<{
  name: string;
  version: string;
}>;

export type RendererProfile = Readonly<{
  renderer: RendererName;
  protocolVersion: typeof RENDERER_PROTOCOL_VERSION;
  compiler: RendererPackageIdentity;
  hydration: RendererPackageIdentity;
  router: RendererPackageIdentity &
    Readonly<{ coreName: string; coreVersion: string }>;
}>;

const exactFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
  errors: BackendFederationContractValidationError[],
) => {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) {
      addError(errors, `${path}.${field}`, 'is not a supported field.');
    }
  }
};

const canonicalString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;

const exactPackageVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const validateRenderer = (
  value: Record<string, unknown>,
  path: string,
  errors: BackendFederationContractValidationError[],
) => {
  if (!RENDERERS.some(renderer => renderer === value.renderer)) {
    addError(
      errors,
      `${path}.renderer`,
      'must be "react", "solid", or "octane".',
    );
  }
  if (value.protocolVersion !== RENDERER_PROTOCOL_VERSION) {
    addError(
      errors,
      `${path}.protocolVersion`,
      `must be ${RENDERER_PROTOCOL_VERSION}.`,
    );
  }
};

export const validateRendererIdentity = (
  value: unknown,
  path = 'rendererIdentity',
): BackendFederationContractValidationResult => {
  const errors: BackendFederationContractValidationError[] = [];
  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return validationResult(errors);
  }
  exactFields(
    value,
    ['renderer', 'appId', 'entryName', 'protocolVersion', 'buildId'],
    path,
    errors,
  );
  validateRenderer(value, path, errors);
  for (const field of ['appId', 'entryName', 'buildId']) {
    if (!canonicalString(value[field])) {
      addError(
        errors,
        `${path}.${field}`,
        'must be a non-empty trimmed string.',
      );
    }
  }
  return validationResult(errors);
};

const validatePackageIdentity = (
  value: unknown,
  path: string,
  errors: BackendFederationContractValidationError[],
  router = false,
  hydration = false,
) => {
  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return;
  }
  exactFields(
    value,
    router
      ? ['name', 'version', 'coreName', 'coreVersion']
      : ['name', 'version'],
    path,
    errors,
  );
  if (!canonicalString(value.name)) {
    addError(errors, `${path}.name`, 'must be a non-empty trimmed string.');
  }
  if (router && !canonicalString(value.coreName)) {
    addError(errors, `${path}.coreName`, 'must be a non-empty trimmed string.');
  }
  for (const field of router ? ['version', 'coreVersion'] : ['version']) {
    if (
      !canonicalString(value[field]) ||
      !(
        exactPackageVersion.test(value[field]) ||
        (hydration && /^[1-9]\d*$/.test(value[field]))
      )
    ) {
      addError(errors, `${path}.${field}`, 'must be an exact version.');
    }
  }
};

/** Validate the actual router package and the package that owns its core. */
export const validateRendererRouterPackageIdentity = (
  value: unknown,
  path = 'routerPackage',
): BackendFederationContractValidationResult => {
  const errors: BackendFederationContractValidationError[] = [];
  validatePackageIdentity(value, path, errors, true);
  return validationResult(errors);
};

export const validateRendererProfile = (
  value: unknown,
  path = 'rendererProfile',
): BackendFederationContractValidationResult => {
  const errors: BackendFederationContractValidationError[] = [];
  if (!isRecord(value)) {
    addError(errors, path, 'must be an object.');
    return validationResult(errors);
  }
  exactFields(
    value,
    ['renderer', 'protocolVersion', 'compiler', 'hydration', 'router'],
    path,
    errors,
  );
  validateRenderer(value, path, errors);
  validatePackageIdentity(value.compiler, `${path}.compiler`, errors);
  validatePackageIdentity(
    value.hydration,
    `${path}.hydration`,
    errors,
    false,
    true,
  );
  validatePackageIdentity(value.router, `${path}.router`, errors, true);
  return validationResult(errors);
};

export const validateRendererProfileCompatibility = (
  expected: unknown,
  actual: unknown,
  path = 'rendererProfile',
): BackendFederationContractValidationResult => {
  const errors = [
    ...validateRendererProfile(expected, `${path}.expected`).errors,
    ...validateRendererProfile(actual, `${path}.actual`).errors,
  ];
  if (errors.length || !isRecord(expected) || !isRecord(actual)) {
    return validationResult(errors);
  }
  if (expected.renderer !== actual.renderer) {
    addError(
      errors,
      `${path}.renderer`,
      'cross-renderer components are unsupported.',
    );
    return validationResult(errors);
  }
  if (expected.protocolVersion !== actual.protocolVersion) {
    addError(
      errors,
      `${path}.protocolVersion`,
      'must match the consuming renderer protocol.',
    );
  }
  for (const field of ['compiler', 'hydration', 'router'] as const) {
    const expectedPackage = expected[field] as Record<string, unknown>;
    const actualPackage = actual[field] as Record<string, unknown>;
    for (const identityField of field === 'router'
      ? ['name', 'version', 'coreName', 'coreVersion']
      : ['name', 'version']) {
      if (expectedPackage[identityField] !== actualPackage[identityField]) {
        addError(
          errors,
          `${path}.${field}.${identityField}`,
          'must match the consuming renderer profile.',
        );
      }
    }
  }
  return validationResult(errors);
};

export const assertRendererProfileCompatibility = (
  expected: unknown,
  actual: unknown,
): void => {
  const result = validateRendererProfileCompatibility(expected, actual);
  if (!result.ok) {
    throw new Error(formatBackendFederationValidationErrors(result.errors));
  }
};

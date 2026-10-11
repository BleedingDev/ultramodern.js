import {
  type RendererProfile,
  validateRendererRouterPackageIdentity,
} from './renderer-profile';
import type {
  BackendFederationContractValidationError,
  BackendFederationContractValidationResult,
} from './types';
import { addError, isRecord, validationResult } from './validation-core';

/** Selected owner metadata, independent of the SDK's finite renderer catalogue. */
export type RouterFramework = string;

export type RouterPackageBinding = RendererProfile['router'] &
  Readonly<{ framework: RouterFramework }>;

type OwnedRouterBinding<Evidence extends 'owned-default' | 'file-routes'> =
  Readonly<{
    owner: string;
    evidence: Evidence;
    defaultProvider: RouterPackageBinding;
    providers: readonly [RouterPackageBinding];
  }>;

type RouterProviderRegistryBinding = Readonly<{
  owner: string;
  evidence: 'provider-registry';
  defaultProvider: RouterPackageBinding;
  /** Registered providers are available; this does not attest app selection. */
  providers: readonly RouterPackageBinding[];
}>;

export type RendererRouterBinding =
  | OwnedRouterBinding<'owned-default'>
  | OwnedRouterBinding<'file-routes'>
  | RouterProviderRegistryBinding;

export type RendererRouterBindings = Readonly<
  Record<string, RendererRouterBinding>
>;

const immutableRouterPackage = (
  provider: RouterPackageBinding,
): RouterPackageBinding =>
  Object.freeze({
    framework: provider.framework,
    name: provider.name,
    version: provider.version,
    coreName: provider.coreName,
    coreVersion: provider.coreVersion,
  });

const immutableRouterBinding = (
  binding: RendererRouterBinding,
): RendererRouterBinding => {
  const defaultProvider = immutableRouterPackage(binding.defaultProvider);
  if (binding.evidence === 'provider-registry') {
    return Object.freeze({
      owner: binding.owner,
      evidence: binding.evidence,
      defaultProvider,
      providers: Object.freeze(binding.providers.map(immutableRouterPackage)),
    });
  }
  const providers: [RouterPackageBinding] = [
    immutableRouterPackage(binding.providers[0]),
  ];
  return Object.freeze({
    owner: binding.owner,
    evidence: binding.evidence,
    defaultProvider,
    providers: Object.freeze(providers),
  });
};

/** Snapshot already validated canonical bindings without retaining input objects. */
export const immutableRendererRouterBindings = (
  bindings: RendererRouterBindings,
): RendererRouterBindings => {
  const snapshot: Record<string, RendererRouterBinding> = {};
  for (const [entryName, binding] of Object.entries(bindings)) {
    snapshot[entryName] = immutableRouterBinding(binding);
  }
  return Object.freeze(snapshot);
};

const canonicalString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;

const safeEntryName = (value: unknown): value is string =>
  canonicalString(value) && value !== '__proto__';

const plainRecord = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const exactFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
  errors: BackendFederationContractValidationError[],
) => {
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== 'string' || !fields.includes(field)) {
      addError(errors, `${path}.${String(field)}`, 'is not a supported field.');
    }
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      addError(errors, `${path}.${field}`, 'is required.');
    }
  }
};

const validateProvider = (
  value: unknown,
  path: string,
  errors: BackendFederationContractValidationError[],
  routerFrameworks?: readonly RouterFramework[],
): value is RouterPackageBinding => {
  const previousErrors = errors.length;
  if (!plainRecord(value)) {
    addError(errors, path, 'must be a plain object.');
    return false;
  }
  exactFields(
    value,
    ['framework', 'name', 'version', 'coreName', 'coreVersion'],
    path,
    errors,
  );
  if (
    !canonicalString(value.framework) ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value.framework)
  ) {
    addError(
      errors,
      `${path}.framework`,
      'must be a lowercase router framework token separated by single hyphens.',
    );
  } else if (
    routerFrameworks !== undefined &&
    !routerFrameworks.includes(value.framework)
  ) {
    addError(
      errors,
      `${path}.framework`,
      'must be admitted by the selected router owner.',
    );
  }
  errors.push(
    ...validateRendererRouterPackageIdentity(
      {
        name: value.name,
        version: value.version,
        coreName: value.coreName,
        coreVersion: value.coreVersion,
      },
      path,
    ).errors,
  );
  return errors.length === previousErrors;
};

const validateBinding = (
  value: unknown,
  path: string,
  errors: BackendFederationContractValidationError[],
  routerFrameworks?: readonly RouterFramework[],
) => {
  if (!plainRecord(value)) {
    addError(errors, path, 'must be a plain object.');
    return;
  }
  exactFields(
    value,
    ['owner', 'evidence', 'defaultProvider', 'providers'],
    path,
    errors,
  );
  if (!canonicalString(value.owner)) {
    addError(errors, `${path}.owner`, 'must be a non-empty trimmed string.');
  }
  if (
    value.evidence !== 'owned-default' &&
    value.evidence !== 'file-routes' &&
    value.evidence !== 'provider-registry'
  ) {
    addError(
      errors,
      `${path}.evidence`,
      'must be "owned-default", "file-routes", or "provider-registry".',
    );
  }
  const defaultProvider = value.defaultProvider;
  const validDefault = validateProvider(
    defaultProvider,
    `${path}.defaultProvider`,
    errors,
    routerFrameworks,
  );
  if (!Array.isArray(value.providers) || value.providers.length === 0) {
    addError(errors, `${path}.providers`, 'must be a non-empty array.');
    return;
  }
  const providers: RouterPackageBinding[] = [];
  const frameworks = new Set<RouterFramework>();
  for (let index = 0; index < value.providers.length; index++) {
    const provider = value.providers[index];
    const providerPath = `${path}.providers[${index}]`;
    if (!validateProvider(provider, providerPath, errors, routerFrameworks))
      continue;
    if (frameworks.has(provider.framework)) {
      addError(
        errors,
        `${providerPath}.framework`,
        'must be unique within the entry.',
      );
    }
    frameworks.add(provider.framework);
    providers.push(provider);
  }
  if (validDefault) {
    if (
      !providers.some(provider =>
        (
          ['framework', 'name', 'version', 'coreName', 'coreVersion'] as const
        ).every(field => provider[field] === defaultProvider[field]),
      )
    ) {
      addError(
        errors,
        `${path}.defaultProvider`,
        'must exactly match a registered provider.',
      );
    }
  }
  if (
    (value.evidence === 'owned-default' || value.evidence === 'file-routes') &&
    value.providers.length !== 1
  ) {
    addError(
      errors,
      `${path}.providers`,
      'must contain only the owned default provider.',
    );
  }
};

/** Validate per-entry provenance without inferring which provider app source uses. */
export const validateRendererRouterBindings = (
  value: unknown,
  expectedEntryNames: readonly string[],
  path = 'routerBindings',
  routerFrameworks?: readonly RouterFramework[],
): BackendFederationContractValidationResult => {
  const errors: BackendFederationContractValidationError[] = [];
  if (
    routerFrameworks !== undefined &&
    (!Array.isArray(routerFrameworks) ||
      !routerFrameworks.length ||
      new Set(routerFrameworks).size !== routerFrameworks.length ||
      !routerFrameworks.every(
        framework =>
          canonicalString(framework) &&
          /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(framework),
      ))
  ) {
    addError(
      errors,
      path,
      'selected router frameworks must be unique lowercase tokens in a non-empty array.',
    );
    return validationResult(errors);
  }
  if (!plainRecord(value)) {
    addError(errors, path, 'must be a plain object.');
    return validationResult(errors);
  }
  if (!Array.isArray(expectedEntryNames)) {
    addError(errors, path, 'expected entry names must be an array.');
    return validationResult(errors);
  }
  const expected = new Set<string>();
  for (const entryName of expectedEntryNames) {
    if (!safeEntryName(entryName)) {
      addError(
        errors,
        path,
        'expected entry names must be non-empty trimmed strings other than "__proto__".',
      );
      continue;
    }
    if (expected.has(entryName)) {
      addError(errors, path, `expected entry "${entryName}" must be unique.`);
    }
    expected.add(entryName);
    if (!Object.hasOwn(value, entryName)) {
      addError(
        errors,
        `${path}.${entryName}`,
        'is required for the expected entry.',
      );
    }
  }
  for (const entryName of Reflect.ownKeys(value)) {
    if (!safeEntryName(entryName)) {
      addError(
        errors,
        `${path}.${String(entryName)}`,
        'must be a non-empty trimmed entry name other than "__proto__".',
      );
      continue;
    }
    if (!expected.has(entryName)) {
      addError(errors, `${path}.${entryName}`, 'is not an expected entry.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, entryName);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      addError(
        errors,
        `${path}.${entryName}`,
        'must be an enumerable data property.',
      );
      continue;
    }
    validateBinding(
      descriptor.value,
      `${path}.${entryName}`,
      errors,
      routerFrameworks,
    );
  }
  return validationResult(errors);
};

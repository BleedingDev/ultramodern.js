import {
  assertRendererProfileCompatibility,
  formatBackendFederationValidationErrors,
  type RendererIdentity,
  type RendererPackageIdentity,
  type RendererProfile,
  validateRendererIdentity,
  validateRendererProfile,
} from '@modern-js/backend-federation-contracts';

export const RENDERER_FEDERATION_METADATA_KEY = 'ultramodernRenderer';
export const RENDERER_FEDERATION_SCHEMA = 'ultramodern.renderer-federation';
export const RENDERER_FEDERATION_SCHEMA_VERSION = 1;

/** The consuming renderer tuple; application and source identities are independent. */
export interface RendererFederationCompatibility {
  readonly profile: RendererProfile;
  readonly runtime: RendererPackageIdentity;
  readonly bootstrap: RendererPackageIdentity;
}

/** Finalized native build authority for both browser and SSR remote entries. */
export interface RendererFederationContract
  extends RendererFederationCompatibility {
  readonly schema: typeof RENDERER_FEDERATION_SCHEMA;
  readonly schemaVersion: typeof RENDERER_FEDERATION_SCHEMA_VERSION;
  readonly identities: Readonly<Record<string, RendererIdentity>>;
}

export const rendererFederationError = (message: string): Error =>
  new Error(`Renderer federation manifest contract: ${message}`);

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const exactFields = (
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void => {
  const unknown = Object.keys(value).filter(key => !fields.includes(key));
  const missing = fields.filter(key => !Object.hasOwn(value, key));
  if (unknown.length || missing.length)
    throw rendererFederationError(
      `${label} fields differ (unknown=${unknown.join(',')}; missing=${missing.join(',')}).`,
    );
};

const assertProfile = (value: unknown): RendererProfile => {
  const result = validateRendererProfile(value, 'rendererProfile');
  if (!result.ok)
    throw rendererFederationError(
      formatBackendFederationValidationErrors(result.errors),
    );
  const profile = value as RendererProfile;
  return Object.freeze({
    ...profile,
    compiler: Object.freeze({ ...profile.compiler }),
    hydration: Object.freeze({ ...profile.hydration }),
    router: Object.freeze({ ...profile.router }),
  });
};

// The shared contract's compiler package validator also owns exact package
// names/versions for runtime and bootstrap; do not maintain another semver ABI.
const assertPackage = (
  value: unknown,
  profile: RendererProfile,
  label: string,
): RendererPackageIdentity => {
  const result = validateRendererProfile(
    { ...profile, compiler: value },
    label,
  );
  if (!result.ok)
    throw rendererFederationError(
      formatBackendFederationValidationErrors(result.errors),
    );
  return Object.freeze({ ...(value as RendererPackageIdentity) });
};

export function readRendererFederationCompatibility(
  value: unknown,
): RendererFederationCompatibility {
  if (!record(value))
    throw rendererFederationError('the consuming renderer tuple is absent.');
  exactFields(value, ['profile', 'runtime', 'bootstrap'], 'compatibility');
  const profile = assertProfile(value.profile);
  return Object.freeze({
    profile,
    runtime: assertPackage(value.runtime, profile, 'runtime'),
    bootstrap: assertPackage(value.bootstrap, profile, 'bootstrap'),
  });
}

export function readRendererFederationContract(
  value: unknown,
): RendererFederationContract {
  if (!record(value))
    throw rendererFederationError('renderer publication metadata is absent.');
  exactFields(
    value,
    [
      'schema',
      'schemaVersion',
      'profile',
      'runtime',
      'bootstrap',
      'identities',
    ],
    'publication',
  );
  if (
    value.schema !== RENDERER_FEDERATION_SCHEMA ||
    value.schemaVersion !== RENDERER_FEDERATION_SCHEMA_VERSION
  )
    throw rendererFederationError('unsupported renderer publication schema.');
  const compatibility = readRendererFederationCompatibility({
    profile: value.profile,
    runtime: value.runtime,
    bootstrap: value.bootstrap,
  });
  if (!record(value.identities) || !Object.keys(value.identities).length)
    throw rendererFederationError(
      'finalized application entry identities are absent.',
    );
  const identities: Record<string, RendererIdentity> = Object.create(null);
  let appId: string | undefined;
  for (const [entryName, valueIdentity] of Object.entries(value.identities)) {
    const result = validateRendererIdentity(
      valueIdentity,
      `identities.${entryName}`,
    );
    if (!result.ok)
      throw rendererFederationError(
        formatBackendFederationValidationErrors(result.errors),
      );
    const identity = valueIdentity as RendererIdentity;
    if (
      identity.entryName !== entryName ||
      identity.renderer !== compatibility.profile.renderer ||
      identity.protocolVersion !== compatibility.profile.protocolVersion ||
      (appId !== undefined && identity.appId !== appId)
    )
      throw rendererFederationError(
        `incoherent publication identity for ${entryName}.`,
      );
    appId = identity.appId;
    identities[entryName] = Object.freeze({ ...identity });
  }
  return Object.freeze({
    schema: RENDERER_FEDERATION_SCHEMA,
    schemaVersion: RENDERER_FEDERATION_SCHEMA_VERSION,
    ...compatibility,
    identities: Object.freeze(identities),
  });
}

export function assertRendererFederationCompatibility(
  expected: RendererFederationCompatibility,
  actual: RendererFederationCompatibility,
): void {
  try {
    assertRendererProfileCompatibility(expected.profile, actual.profile);
  } catch (error) {
    throw rendererFederationError(
      error instanceof Error ? error.message : String(error),
    );
  }
  for (const field of ['runtime', 'bootstrap'] as const)
    for (const key of ['name', 'version'] as const)
      if (expected[field][key] !== actual[field][key])
        throw rendererFederationError(
          `${field}.${key} must match the consuming renderer tuple.`,
        );
}

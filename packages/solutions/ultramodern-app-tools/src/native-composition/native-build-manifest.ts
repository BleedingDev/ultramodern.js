import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { RendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import {
  immutableRendererRouterBindings,
  type RendererRouterBindings,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import {
  identityCacheKey,
  type RendererIdentity,
} from '@modern-js/renderer-core';
import type { RendererBuildProfile } from './renderer-profile';

export const RENDERER_BUILD_MANIFEST_FILE = 'renderer-build.json';
export const RENDERER_DEVELOPMENT_DIRECTORY = '.ultramodern-dev';

export interface RendererDevelopmentCompilation {
  readonly compilationHashes: Readonly<Record<string, string>>;
  readonly generation: number;
  readonly sourceInputDigest: string;
}

export interface RendererBuildManifest extends RendererBuildIdentities {
  readonly schema: 'ultramodern-renderer-build';
  readonly version: 1;
  readonly profile: RendererBuildProfile;
  readonly routerBindings: RendererRouterBindings;
}

export interface RendererDevelopmentBuildManifest
  extends RendererBuildManifest {
  readonly devCompilation: RendererDevelopmentCompilation;
}

/** A dev checkpoint certifies an actual completed wave, never a production build. */
export function validateRendererDevelopmentBuildManifest(
  input: unknown,
  profile: RendererBuildProfile,
): RendererDevelopmentBuildManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid development renderer metadata');
  const descriptor = Object.getOwnPropertyDescriptor(input, 'devCompilation');
  if (!descriptor?.enumerable || !('value' in descriptor))
    throw new Error(
      'Development renderer metadata requires an own compilation record',
    );
  const compilation: unknown = descriptor.value;
  const keys = ['compilationHashes', 'generation', 'sourceInputDigest'];
  if (
    !compilation ||
    typeof compilation !== 'object' ||
    Array.isArray(compilation) ||
    Reflect.ownKeys(compilation).length !== keys.length ||
    !Reflect.ownKeys(compilation).every(
      key => typeof key === 'string' && keys.includes(key),
    )
  )
    throw new Error('Invalid development compilation record');
  const fields: Record<string, unknown> = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(compilation, key);
    if (!field?.enumerable || !('value' in field))
      throw new Error(
        'Development compilation fields must be enumerable data properties',
      );
    fields[key] = field.value;
  }
  const hashes = fields.compilationHashes;
  if (
    !hashes ||
    typeof hashes !== 'object' ||
    Array.isArray(hashes) ||
    !Reflect.ownKeys(hashes).length
  )
    throw new Error(
      'Development compilation requires its actual named compiler hashes',
    );
  const compilationHashes: Record<string, string> = {};
  for (const name of Reflect.ownKeys(hashes)) {
    const hash = Object.getOwnPropertyDescriptor(hashes, name);
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name !== name.trim() ||
      !hash?.enumerable ||
      !('value' in hash) ||
      typeof hash.value !== 'string' ||
      !/^[a-f0-9]{1,64}$(?![\s\S])/u.test(hash.value)
    )
      throw new Error(
        'Development compilation requires enumerable named hash data',
      );
    Object.defineProperty(compilationHashes, name, {
      value: hash.value,
      enumerable: true,
    });
  }
  if (
    typeof fields.generation !== 'number' ||
    !Number.isSafeInteger(fields.generation) ||
    fields.generation < 1 ||
    typeof fields.sourceInputDigest !== 'string' ||
    !/^[a-f0-9]{64}$(?![\s\S])/u.test(fields.sourceInputDigest)
  )
    throw new Error(
      'Invalid development compilation generation or source digest',
    );
  const base = validateRendererBuildManifest(input, profile);
  if (base.cacheAllowed || base.promotable)
    throw new Error(
      'Development renderer metadata cannot be cached or promoted',
    );
  return Object.freeze({
    ...base,
    devCompilation: Object.freeze({
      compilationHashes: Object.freeze(compilationHashes),
      generation: fields.generation,
      sourceInputDigest: fields.sourceInputDigest,
    }),
  });
}

/** Do not attest an output compiled while its authored or framework inputs changed. */
export function assertRendererBuildInputsUnchanged(
  initial: RendererBuildIdentities,
  completed: RendererBuildIdentities,
): void {
  const fields = [
    'buildMarker',
    'sourceRevision',
    'inputDigest',
    'profileDigest',
    'compilerDigest',
    'frameworkCohortDigest',
    'cacheAllowed',
    'promotable',
    'identities',
    'routerBindings',
  ] as const;
  const changed = fields.filter(
    key => !isDeepStrictEqual(initial[key], completed[key]),
  );
  if (!changed.length) return;
  const describe = (
    value: RendererBuildIdentities,
    key: (typeof fields)[number],
  ): string => {
    const field = value[key];
    if (key === 'identities')
      return JSON.stringify(
        Object.entries(value.identities)
          .slice(0, 8)
          .map(([entry, identity]) => ({
            entry: entry.slice(0, 128),
            renderer: identity.renderer,
            appId: identity.appId.slice(0, 128),
            entryName: identity.entryName.slice(0, 128),
            protocolVersion: identity.protocolVersion,
            buildId: identity.buildId,
          })),
      ).slice(0, 512);
    if (key === 'routerBindings')
      return JSON.stringify(
        Object.entries(value.routerBindings)
          .slice(0, 8)
          .map(([entry, binding]) => ({
            entry: entry.slice(0, 128),
            owner: binding.owner.slice(0, 128),
            evidence: binding.evidence,
            providers: binding.providers.slice(0, 8).map(provider => ({
              name: provider.name,
              version: provider.version,
            })),
          })),
      ).slice(0, 512);
    return JSON.stringify(
      typeof field === 'string' ? field.slice(0, 128) : field,
    );
  };
  const differences = changed
    .map(
      key =>
        `${key}: expected=${describe(initial, key)}, actual=${describe(completed, key)}`,
    )
    .join('; ');
  throw new Error(
    `Native build inputs changed during compilation (${changed[0]}); rebuild from one unchanged source and framework cohort. Changed identity fields: ${differences}`,
  );
}

function freezeProfile<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeProfile(child);
    Object.freeze(value);
  }
  return value;
}

/** Built identity is immutable evidence. Missing or conflicting bytes fail closed. */
export function validateRendererBuildManifest(
  input: unknown,
  profile: RendererBuildProfile,
): RendererBuildManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid native renderer build manifest');
  const value = input as RendererBuildManifest;
  if (
    value.schema !== 'ultramodern-renderer-build' ||
    value.version !== 1 ||
    !isDeepStrictEqual(value.profile, profile)
  )
    throw new Error(
      'Native renderer build manifest profile conflicts with the selected configuration',
    );
  for (const key of [
    'buildMarker',
    'inputDigest',
    'profileDigest',
    'compilerDigest',
    'frameworkCohortDigest',
  ] as const) {
    if (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(value[key]))
      throw new Error(`Native renderer build manifest requires a valid ${key}`);
  }
  if (
    typeof value.sourceRevision !== 'string' ||
    !value.sourceRevision.trim() ||
    typeof value.cacheAllowed !== 'boolean' ||
    typeof value.promotable !== 'boolean'
  )
    throw new Error('Invalid native renderer build provenance');
  if (
    !value.identities ||
    typeof value.identities !== 'object' ||
    Array.isArray(value.identities) ||
    !Object.keys(value.identities).length
  )
    throw new Error(
      'Native renderer build manifest has no application entries',
    );
  for (const [entryName, identity] of Object.entries(value.identities)) {
    identityCacheKey(identity as RendererIdentity);
    if (
      identity.renderer !== profile.renderer ||
      identity.entryName !== entryName ||
      identity.buildId !== value.buildMarker
    )
      throw new Error(
        'Native renderer build manifest entry identity conflicts with its build',
      );
  }
  if (
    (value.cacheAllowed || value.promotable) &&
    value.sourceRevision === 'workspace'
  )
    throw new Error(
      'A dirty native renderer build cannot be promoted or cached',
    );
  const routerValidation = validateRendererRouterBindings(
    value.routerBindings,
    Object.keys(value.identities),
    'routerBindings',
    profile.renderer,
  );
  if (!routerValidation.ok)
    throw new Error(
      `Invalid built renderer router bindings: ${JSON.stringify(routerValidation.errors)}`,
    );
  return Object.freeze({
    ...value,
    profile: freezeProfile(structuredClone(profile)),
    identities: Object.freeze(
      Object.fromEntries(
        Object.entries(value.identities).map(([entryName, identity]) => [
          entryName,
          Object.freeze({ ...identity }),
        ]),
      ),
    ),
    routerBindings: immutableRendererRouterBindings(value.routerBindings),
  });
}

export async function readRendererBuildManifest(
  distDirectory: string,
  profile: RendererBuildProfile,
): Promise<RendererBuildManifest> {
  return validateRendererBuildManifest(
    JSON.parse(
      await fs.readFile(
        path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE),
        'utf8',
      ),
    ),
    profile,
  );
}

export async function readRendererDevelopmentBuildManifest(
  distDirectory: string,
  profile: RendererBuildProfile,
): Promise<RendererDevelopmentBuildManifest> {
  return validateRendererDevelopmentBuildManifest(
    JSON.parse(
      await fs.readFile(
        path.join(
          distDirectory,
          RENDERER_DEVELOPMENT_DIRECTORY,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
        'utf8',
      ),
    ),
    profile,
  );
}

import {
  assertRendererIdentity,
  type RendererIdentity,
} from '@modern-js/renderer-core/identity';

export const SOLID_COMPILER_VERSION = '2.0.0-rc.13';
export function solidModuleManifestFilename(entryName: string): string {
  if (typeof entryName !== 'string' || entryName.length === 0) {
    throw new Error('A Solid module manifest requires a nonempty entry name');
  }
  return `solid-module-manifest.${encodeURIComponent(entryName)}.json`;
}

/** The compiler's structural JSON boundary matches native Solid AssetManifest. */
interface SolidPreloadAttributes {
  type?: string;
  crossorigin?: '' | true | 'anonymous' | 'use-credentials';
  integrity?: string;
  referrerpolicy?:
    | 'no-referrer'
    | 'no-referrer-when-downgrade'
    | 'origin'
    | 'origin-when-cross-origin'
    | 'same-origin'
    | 'strict-origin'
    | 'strict-origin-when-cross-origin'
    | 'unsafe-url';
  fetchpriority?: 'high' | 'low' | 'auto';
  media?: string;
}

export type SolidPreloadLink = SolidPreloadAttributes &
  (
    | {
        href: string;
        as: 'fetch' | 'font' | 'script' | 'style' | 'track';
        imagesrcset?: never;
        imagesizes?: never;
      }
    | { href: string; as: 'image'; imagesrcset?: string; imagesizes?: string }
    | { href?: never; as: 'image'; imagesrcset: string; imagesizes?: string }
  );

export interface SolidAssetChunk {
  file: string;
  css?: string[];
  imports?: string[];
  isEntry?: boolean;
  preloads?: SolidPreloadLink[];
}

export type SolidAssetManifest = Record<string, SolidAssetChunk> & {
  _base?: string;
};

export interface SolidModuleManifest {
  schemaVersion: 1;
  renderer: 'solid';
  compilerVersion: typeof SOLID_COMPILER_VERSION;
  /** The shared source-build identity owner stamps this before runtime use. */
  rendererIdentity: RendererIdentity;
  modules: SolidAssetManifest;
}

function requireRecord(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`Invalid Solid module manifest ${description}`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !descriptor || !('value' in descriptor)) {
      throw new Error(
        `Invalid Solid module manifest ${description}: data properties are required`,
      );
    }
  }
  return value as Record<string, unknown>;
}

function requireArray(
  value: unknown,
  description: string,
): asserts value is unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new Error(
      `Invalid Solid module manifest ${description}: an array is required`,
    );
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)) ||
      !descriptor ||
      !('value' in descriptor)
    ) {
      throw new Error(
        `Invalid Solid module manifest ${description}: array data properties are required`,
      );
    }
  }
}

function requireStrings(
  value: unknown,
  description: string,
): asserts value is string[] {
  requireArray(value, description);
  for (let index = 0; index < value.length; index++) {
    if (typeof value[index] !== 'string' || !value[index]) {
      throw new Error(
        `Invalid Solid module manifest ${description}: nonempty strings are required`,
      );
    }
  }
}

/** Validate the same path concatenation used by the native rc13 asset resolver. */
function validateAssetUrl(base: string | undefined, file: string): void {
  const prefix = base || '/';
  const joined = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(file)
    ? file
    : `${prefix.endsWith('/') ? prefix : `${prefix}/`}${file.startsWith('/') ? file.slice(1) : file}`;
  try {
    new URL(joined, 'https://manifest.invalid/');
  } catch (cause) {
    throw new Error(`Invalid Solid module manifest asset URL: ${file}`, {
      cause,
    });
  }
}

function validatePreload(value: unknown, base: string | undefined): void {
  const link = requireRecord(value, 'preload');
  if (
    !['fetch', 'font', 'image', 'script', 'style', 'track'].includes(
      link.as as string,
    )
  ) {
    throw new Error('Invalid Solid module manifest preload destination');
  }
  if (link.href !== undefined) {
    if (typeof link.href !== 'string' || !link.href) {
      throw new Error('Invalid Solid module manifest preload href');
    }
    validateAssetUrl(base, link.href);
  }
  if (link.as === 'image') {
    if (
      link.imagesrcset !== undefined &&
      (typeof link.imagesrcset !== 'string' || !link.imagesrcset)
    ) {
      throw new Error('Invalid Solid module manifest image preload source set');
    }
    if (link.href === undefined && link.imagesrcset === undefined) {
      throw new Error('Invalid Solid module manifest image preload source');
    }
    if (link.imagesizes !== undefined && typeof link.imagesizes !== 'string') {
      throw new Error('Invalid Solid module manifest image preload sizes');
    }
  } else if (
    link.href === undefined ||
    link.imagesrcset !== undefined ||
    link.imagesizes !== undefined
  ) {
    throw new Error('Invalid Solid module manifest preload source');
  }
  for (const key of ['type', 'integrity', 'media']) {
    if (link[key] !== undefined && typeof link[key] !== 'string') {
      throw new Error(`Invalid Solid module manifest preload ${key}`);
    }
  }
  const enumerated: Record<string, readonly unknown[]> = {
    crossorigin: ['', true, 'anonymous', 'use-credentials'],
    fetchpriority: ['high', 'low', 'auto'],
    referrerpolicy: [
      'no-referrer',
      'no-referrer-when-downgrade',
      'origin',
      'origin-when-cross-origin',
      'same-origin',
      'strict-origin',
      'strict-origin-when-cross-origin',
      'unsafe-url',
    ],
  };
  for (const [key, values] of Object.entries(enumerated)) {
    if (link[key] !== undefined && !values.includes(link[key])) {
      throw new Error(`Invalid Solid module manifest preload ${key}`);
    }
  }
}

export function validateSolidModuleManifest(
  value: unknown,
  expectedIdentity: RendererIdentity,
  requiredModuleKeys: readonly string[] = [],
): SolidModuleManifest {
  if (!value || typeof value !== 'object') {
    throw new Error(
      'Missing Solid module manifest. Rebuild the application before SSR or hydration.',
    );
  }
  const manifest = requireRecord(value, 'envelope');
  if (
    manifest.schemaVersion !== 1 ||
    manifest.renderer !== 'solid' ||
    manifest.compilerVersion !== SOLID_COMPILER_VERSION
  ) {
    throw new Error(
      `Solid module manifest compiler ABI mismatch. Rebuild with @solidjs/compiler ${SOLID_COMPILER_VERSION}.`,
    );
  }
  if (!manifest.rendererIdentity || expectedIdentity.renderer !== 'solid') {
    throw new Error(
      'Solid module manifest requires the current Solid application build identity.',
    );
  }
  try {
    const identity = requireRecord(
      manifest.rendererIdentity,
      'renderer identity',
    );
    if (
      typeof identity.renderer !== 'string' ||
      typeof identity.appId !== 'string' ||
      typeof identity.entryName !== 'string' ||
      typeof identity.buildId !== 'string' ||
      identity.protocolVersion !== 1
    ) {
      throw new Error('Invalid Solid module manifest renderer identity');
    }
    assertRendererIdentity(
      identity as unknown as RendererIdentity,
      expectedIdentity,
    );
  } catch (cause) {
    throw new Error(
      'Stale Solid module manifest identity. Serve the manifest and hydration assets from the same application build.',
      { cause },
    );
  }
  if (
    !manifest.modules ||
    typeof manifest.modules !== 'object' ||
    Array.isArray(manifest.modules)
  ) {
    throw new Error(
      'Solid module manifest has no module inventory. Rebuild the application.',
    );
  }
  const modules = requireRecord(manifest.modules, 'module inventory');
  if (modules._base !== undefined && typeof modules._base !== 'string') {
    throw new Error('Invalid Solid module manifest asset base');
  }
  const base = modules._base as string | undefined;
  for (const [key, value] of Object.entries(modules)) {
    if (key === '_base') continue;
    const chunk = requireRecord(value, `chunk ${key}`);
    if (typeof chunk.file !== 'string' || !chunk.file) {
      throw new Error(
        `Invalid Solid module manifest chunk ${key}: a nonempty file is required`,
      );
    }
    validateAssetUrl(base, chunk.file);
    for (const field of ['css', 'imports']) {
      if (chunk[field] !== undefined)
        requireStrings(chunk[field], `${key}.${field}`);
    }
    for (const file of (chunk.css as string[] | undefined) ?? [])
      validateAssetUrl(base, file);
    if (chunk.isEntry !== undefined && typeof chunk.isEntry !== 'boolean') {
      throw new Error(
        `Invalid Solid module manifest chunk ${key}: isEntry must be boolean`,
      );
    }
    if (chunk.preloads !== undefined) {
      requireArray(chunk.preloads, `${key}.preloads`);
      for (const preload of chunk.preloads) validatePreload(preload, base);
    }
  }
  for (const [key, value] of Object.entries(modules)) {
    if (key === '_base') continue;
    for (const dependency of (value as SolidAssetChunk).imports ?? []) {
      if (dependency === '_base' || !Object.hasOwn(modules, dependency)) {
        throw new Error(
          `Solid module manifest chunk ${key} imports missing own chunk ${dependency}`,
        );
      }
    }
  }
  for (const key of requiredModuleKeys) {
    if (key === '_base' || !Object.hasOwn(modules, key)) {
      throw new Error(
        `Solid module manifest is missing ${key}. Rebuild the application before SSR or hydration.`,
      );
    }
  }
  return manifest as unknown as SolidModuleManifest;
}

export function resolveSolidModuleAsset(
  manifest: unknown,
  expectedIdentity: RendererIdentity,
  key: string,
): SolidAssetChunk {
  return validateSolidModuleManifest(manifest, expectedIdentity, [key]).modules[
    key
  ] as SolidAssetChunk;
}

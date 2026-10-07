import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  type RendererBuildIdentities,
  rendererProfileKey,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import {
  immutableRendererRouterBindings,
  type RendererRouterBindings,
  type RouterFramework,
  validateRendererRouterBindings,
} from '@modern-js/backend-federation-contracts';
import {
  identityCacheKey,
  type Renderer,
  type RendererIdentity,
} from '@modern-js/renderer-core';
import type { RendererBuildProfile } from './renderer-profile';
import type { RegisteredRenderer } from './renderer-selection-metadata';

export const RENDERER_BUILD_MANIFEST_FILE = 'renderer-build.json';
export const RENDERER_DEVELOPMENT_DIRECTORY = '.ultramodern-dev';

/** What `serve`, deploy and the Cloudflare worker need from a finished build. */
export interface RendererBuildManifest<
  TRenderer extends Renderer = RegisteredRenderer,
> {
  readonly schema: 'ultramodern-renderer-build';
  readonly version: 2;
  readonly renderer: TRenderer;
  readonly profile: RendererBuildProfile<TRenderer>;
  readonly routerBindings: RendererRouterBindings;
  readonly buildId: string;
  readonly sourceRevision: string;
  readonly entries: Readonly<Record<string, RendererIdentity>>;
}

export interface RendererDevelopmentCompilation {
  readonly compilationHashes: Readonly<Record<string, string>>;
  readonly generation: number;
}

export interface RendererDevelopmentBuildManifest<
  TRenderer extends Renderer = RegisteredRenderer,
> extends RendererBuildManifest<TRenderer> {
  readonly devCompilation: RendererDevelopmentCompilation;
}

export interface RendererBuildManifestValidationOptions {
  readonly routerFrameworks?: readonly RouterFramework[];
}

export function createRendererBuildManifest<TRenderer extends Renderer>(
  profile: RendererBuildProfile<TRenderer>,
  identities: RendererBuildIdentities,
): RendererBuildManifest<TRenderer> {
  return {
    schema: 'ultramodern-renderer-build',
    version: 2,
    renderer: profile.renderer,
    profile,
    routerBindings: identities.routerBindings,
    buildId: identities.buildId,
    sourceRevision: identities.sourceRevision,
    entries: identities.identities,
  };
}

/** Reject a build made for another renderer or renderer profile. */
export function validateRendererBuildManifest<TRenderer extends Renderer>(
  input: unknown,
  profile: RendererBuildProfile<TRenderer>,
  options: RendererBuildManifestValidationOptions = {},
): RendererBuildManifest<TRenderer> {
  const value = input as RendererBuildManifest<TRenderer> | undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    value.schema !== 'ultramodern-renderer-build' ||
    value.version !== 2
  )
    throw new Error(
      `Invalid or outdated ${RENDERER_BUILD_MANIFEST_FILE}; rebuild the application.`,
    );
  if (value.renderer !== profile.renderer)
    throw new Error(
      `The build output was made for the ${String(value.renderer)} renderer, but the configuration selects ${profile.renderer}; rebuild the application.`,
    );
  if (!isDeepStrictEqual(value.profile, profile))
    throw new Error(
      `The build output was made with a different ${profile.renderer} renderer profile than the installed one; rebuild the application.`,
    );
  if (
    typeof value.buildId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.buildId)
  )
    throw new Error(
      `${RENDERER_BUILD_MANIFEST_FILE} has no valid buildId; rebuild the application.`,
    );
  if (typeof value.sourceRevision !== 'string' || !value.sourceRevision)
    throw new Error(
      `${RENDERER_BUILD_MANIFEST_FILE} has no source revision; rebuild the application.`,
    );
  if (
    !value.entries ||
    typeof value.entries !== 'object' ||
    Array.isArray(value.entries) ||
    !Object.keys(value.entries).length
  )
    throw new Error(
      `${RENDERER_BUILD_MANIFEST_FILE} has no application entries`,
    );
  for (const [entryName, identity] of Object.entries(value.entries)) {
    identityCacheKey(identity);
    if (
      identity.renderer !== profile.renderer ||
      identity.entryName !== entryName ||
      identity.buildId !== value.buildId
    )
      throw new Error(
        `${RENDERER_BUILD_MANIFEST_FILE} entry ${entryName} conflicts with its build`,
      );
  }
  const routerValidation = validateRendererRouterBindings(
    value.routerBindings,
    Object.keys(value.entries),
    'routerBindings',
    options.routerFrameworks,
  );
  if (!routerValidation.ok)
    throw new Error(
      `Invalid built renderer router bindings: ${JSON.stringify(routerValidation.errors)}`,
    );
  return Object.freeze({
    ...value,
    entries: Object.freeze(
      Object.fromEntries(
        Object.entries(value.entries).map(([entryName, identity]) => [
          entryName,
          Object.freeze({ ...identity }),
        ]),
      ),
    ),
    routerBindings: immutableRendererRouterBindings(value.routerBindings),
  });
}

export function validateRendererDevelopmentBuildManifest<
  TRenderer extends Renderer,
>(
  input: unknown,
  profile: RendererBuildProfile<TRenderer>,
  options: RendererBuildManifestValidationOptions = {},
): RendererDevelopmentBuildManifest<TRenderer> {
  const compilation = (input as { devCompilation?: unknown } | undefined)
    ?.devCompilation as RendererDevelopmentCompilation | undefined;
  if (
    !compilation ||
    typeof compilation !== 'object' ||
    !Number.isSafeInteger(compilation.generation) ||
    compilation.generation < 1 ||
    !compilation.compilationHashes ||
    typeof compilation.compilationHashes !== 'object' ||
    !Object.keys(compilation.compilationHashes).length
  )
    throw new Error('Invalid development compilation record');
  return Object.freeze({
    ...validateRendererBuildManifest(input, profile, options),
    devCompilation: Object.freeze({
      compilationHashes: Object.freeze({ ...compilation.compilationHashes }),
      generation: compilation.generation,
    }),
  });
}

type BuildCachePerformance = {
  buildCache?: boolean | { cacheDigest?: readonly unknown[] };
};

/**
 * The persistent Rspack cache is on unless the app opts out, keyed by renderer
 * and profile. An environment's own `buildCache` wins over the top-level one,
 * as it does in Rsbuild.
 */
export function rendererBuildCachePerformance<T extends BuildCachePerformance>(
  performance: T | undefined,
  renderer: Renderer,
  profile: Parameters<typeof rendererProfileKey>[0],
  topLevelBuildCache?: BuildCachePerformance['buildCache'],
): T & BuildCachePerformance {
  const authored = performance?.buildCache;
  if (
    authored === false ||
    (authored === undefined && topLevelBuildCache === false)
  )
    return { ...performance } as T;
  const options = typeof authored === 'object' ? authored : {};
  return {
    ...performance,
    buildCache: {
      ...options,
      cacheDigest: [
        ...(options.cacheDigest ?? []),
        renderer,
        rendererProfileKey(profile),
      ],
    },
  } as T & BuildCachePerformance;
}

export async function writeRendererBuildManifest(
  distDirectory: string,
  manifest: RendererBuildManifest<Renderer>,
): Promise<void> {
  const output = path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE);
  await fs.mkdir(distDirectory, { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(manifest));
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function readRendererBuildManifest<TRenderer extends Renderer>(
  distDirectory: string,
  profile: RendererBuildProfile<TRenderer>,
  options: RendererBuildManifestValidationOptions = {},
): Promise<RendererBuildManifest<TRenderer>> {
  let bytes: string;
  try {
    bytes = await fs.readFile(
      path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE),
      'utf8',
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(
        `${path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE)} is missing; build the application first.`,
      );
    throw error;
  }
  return validateRendererBuildManifest(JSON.parse(bytes), profile, options);
}

export async function readRendererDevelopmentBuildManifest<
  TRenderer extends Renderer,
>(
  distDirectory: string,
  profile: RendererBuildProfile<TRenderer>,
  options: RendererBuildManifestValidationOptions = {},
): Promise<RendererDevelopmentBuildManifest<TRenderer>> {
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
    options,
  );
}

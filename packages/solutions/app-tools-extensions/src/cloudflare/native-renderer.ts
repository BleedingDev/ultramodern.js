import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  type RendererFederationContract,
  readRendererFederationContract,
} from '@modern-js/federation-runtime/renderer-contract';
import {
  readWorkerFederationManifestUrl,
  readWorkerFederationPath,
  readWorkerFederationPublication,
  type WorkerFederationPublication,
  type WorkerFederationService,
} from '@modern-js/renderer-core/worker-federation';
import { WORKER_BUNDLE_DIRECTORY } from './constants';
import type { WorkerRendererBuild } from './renderer-identity';
import { isRecord } from './utils';

/**
 * Build-validated native document inputs for each worker route. The Node host
 * reads these from `dist`; a module worker has no filesystem, so the native
 * build writes them beside its worker bundles and deploy inlines them.
 */
export const NATIVE_RENDERER_WORKER_RESOURCES_FILE = `${WORKER_BUNDLE_DIRECTORY}/native-renderer.json`;

export interface NativeRendererWorkerEntry {
  readonly assets: readonly unknown[];
  readonly nativeManifest?: unknown;
  readonly hydrationBuildId?: string;
  readonly serverConfig: {
    readonly ssr: boolean | 'stream';
    readonly ssrByRouteIds?: readonly string[];
  };
  readonly csrFallbackHeader?: string;
  readonly nonce?: string;
}

export interface NativeWorkerFederationPublication {
  readonly renderer: RendererFederationContract;
  readonly worker: WorkerFederationPublication;
}

export type NativeWorkerFederationService = Omit<
  WorkerFederationService,
  'fetch'
> & { readonly binding: string };

export interface NativeRendererWorkerResources {
  readonly schema: 'ultramodern-native-worker-resources';
  readonly version: 1;
  /** The built renderer, whose adapter serves native documents. */
  readonly renderer: string;
  readonly entries: Readonly<Record<string, NativeRendererWorkerEntry>>;
  readonly workerFederation?: NativeWorkerFederationPublication;
  readonly workerFederationManifestUrl?: string;
  readonly workerFederationServices?: readonly NativeWorkerFederationService[];
}

const invalid = (detail: string) =>
  new Error(
    `Invalid native renderer worker resources (${NATIVE_RENDERER_WORKER_RESOURCES_FILE}): ${detail}. Rebuild the application with deploy.worker.ssr before deploying.`,
  );

function validateEntry(entryName: string, value: unknown) {
  if (!isRecord(value)) throw invalid(`entry ${entryName} is not an object`);
  const { assets, hydrationBuildId, serverConfig, csrFallbackHeader, nonce } =
    value;
  if (!Array.isArray(assets) || !assets.length)
    throw invalid(`entry ${entryName} has no document assets`);
  if (
    hydrationBuildId !== undefined &&
    (typeof hydrationBuildId !== 'string' || !hydrationBuildId.trim())
  )
    throw invalid(`entry ${entryName} has an empty hydration build ID`);
  if (
    !isRecord(serverConfig) ||
    ![true, false, 'stream'].includes(serverConfig.ssr as never) ||
    (serverConfig.ssrByRouteIds !== undefined &&
      (!Array.isArray(serverConfig.ssrByRouteIds) ||
        serverConfig.ssrByRouteIds.some(id => typeof id !== 'string')))
  )
    throw invalid(`entry ${entryName} has an invalid server config`);
  for (const [field, text] of [
    ['csrFallbackHeader', csrFallbackHeader],
    ['nonce', nonce],
  ] as const)
    if (text !== undefined && (typeof text !== 'string' || !text))
      throw invalid(`entry ${entryName} has an invalid ${field}`);
}

function validateFederationResources(
  value: Record<string, unknown>,
  build: WorkerRendererBuild,
) {
  if (value.workerFederation !== undefined) {
    const publication = value.workerFederation;
    if (
      !isRecord(publication) ||
      Object.keys(publication).length !== 2 ||
      !Object.hasOwn(publication, 'renderer') ||
      !Object.hasOwn(publication, 'worker')
    )
      throw invalid('worker federation publication is invalid');
    const renderer = readRendererFederationContract(publication.renderer);
    if (
      renderer.profile.renderer !== build.renderer.name ||
      !isDeepStrictEqual(
        Object.keys(renderer.identities).toSorted(),
        Object.keys(build.identities).toSorted(),
      ) ||
      Object.entries(renderer.identities).some(
        ([entryName, identity]) =>
          !isDeepStrictEqual(identity, build.identities[entryName]),
      )
    )
      throw invalid(
        'worker federation renderer identities differ from the build',
      );
    const worker = readWorkerFederationPublication(
      publication.worker,
      renderer.identities,
    );
    const entries = value.entries as Record<string, NativeRendererWorkerEntry>;
    for (const [expose, coordinate] of Object.entries(worker.exposes)) {
      const entry = entries[coordinate.entryName];
      if (
        !entry?.hydrationBuildId ||
        coordinate.native.publisherBuildId !== entry.hydrationBuildId
      )
        throw invalid(
          `worker federation expose ${expose} differs from its native client build`,
        );
    }
    if (typeof value.workerFederationManifestUrl !== 'string')
      throw invalid('worker federation has no pinned manifest URL');
    readWorkerFederationManifestUrl(value.workerFederationManifestUrl);
  } else if (value.workerFederationManifestUrl !== undefined) {
    throw invalid('worker federation manifest URL has no publication');
  }

  const services = value.workerFederationServices;
  if (services === undefined) return;
  if (!Array.isArray(services))
    throw invalid('worker federation services are not an array');
  const remotes = new Set<string>();
  for (const service of services) {
    if (
      !isRecord(service) ||
      Object.keys(service).some(
        field =>
          !['remote', 'alias', 'binding', 'manifestUrl', 'fragments'].includes(
            field,
          ),
      ) ||
      typeof service.remote !== 'string' ||
      !service.remote ||
      service.remote.trim() !== service.remote ||
      remotes.has(service.remote) ||
      typeof service.binding !== 'string' ||
      !service.binding ||
      service.binding.trim() !== service.binding ||
      (service.alias !== undefined &&
        (typeof service.alias !== 'string' ||
          !service.alias ||
          service.alias.trim() !== service.alias)) ||
      typeof service.manifestUrl !== 'string' ||
      !Array.isArray(service.fragments) ||
      service.fragments.length === 0
    )
      throw invalid('worker federation service has invalid coordinates');
    remotes.add(service.remote);
    if (typeof service.alias === 'string' && service.alias !== service.remote) {
      if (remotes.has(service.alias))
        throw invalid('worker federation service aliases are not unique');
      remotes.add(service.alias);
    }
    readWorkerFederationManifestUrl(service.manifestUrl);
    const exposes = new Set<string>();
    for (const fragment of service.fragments) {
      if (
        !isRecord(fragment) ||
        Object.keys(fragment).length !== 3 ||
        typeof fragment.expose !== 'string' ||
        !fragment.expose ||
        exposes.has(fragment.expose) ||
        typeof fragment.boundaryId !== 'string' ||
        !fragment.boundaryId ||
        !isRecord(fragment.paths) ||
        Object.keys(fragment.paths).length === 0
      )
        throw invalid('worker federation fragment has invalid coordinates');
      exposes.add(fragment.expose);
      Object.values(fragment.paths).forEach(readWorkerFederationPath);
    }
  }
}

/**
 * Read the native worker resources for a built application. Every built entry
 * of the resources' renderer must have validated document inputs.
 */
export async function readNativeRendererWorkerResources(
  distDirectory: string,
  build: WorkerRendererBuild | undefined,
): Promise<NativeRendererWorkerResources | undefined> {
  let bytes: string;
  try {
    bytes = await fs.readFile(
      path.join(distDirectory, NATIVE_RENDERER_WORKER_RESOURCES_FILE),
      'utf8',
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(bytes);
  if (
    !isRecord(value) ||
    value.schema !== 'ultramodern-native-worker-resources' ||
    value.version !== 1 ||
    typeof value.renderer !== 'string' ||
    !value.renderer ||
    !isRecord(value.entries)
  )
    throw invalid('unknown schema');
  if (
    value.renderer !== build?.renderer.name ||
    !build.renderer.nativeDocuments
  )
    throw invalid(
      `renderer ${value.renderer} is not the built native-document renderer`,
    );
  const entries = value.entries;
  const nativeEntries = Object.entries(build.identities).filter(
    ([, identity]) => identity.renderer === value.renderer,
  );
  for (const [entryName] of nativeEntries)
    if (!Object.hasOwn(entries, entryName))
      throw invalid(`entry ${entryName} is missing`);
  for (const [entryName, entry] of Object.entries(entries)) {
    if (!nativeEntries.some(([name]) => name === entryName))
      throw invalid(
        `entry ${entryName} has no built ${value.renderer} renderer identity`,
      );
    validateEntry(entryName, entry);
  }
  validateFederationResources(value, build);
  return value as unknown as NativeRendererWorkerResources;
}

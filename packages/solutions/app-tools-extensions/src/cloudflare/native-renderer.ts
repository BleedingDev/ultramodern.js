import fs from 'node:fs/promises';
import path from 'node:path';
import { WORKER_BUNDLE_DIRECTORY } from './constants';
import type { WorkerRendererIdentities } from './renderer-identity';
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

export interface NativeRendererWorkerResources {
  readonly schema: 'ultramodern-native-worker-resources';
  readonly version: 1;
  /** A native (non-React) renderer name from the built renderer profile. */
  readonly renderer: string;
  readonly entries: Readonly<Record<string, NativeRendererWorkerEntry>>;
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

/** Renderers whose documents are served only by their native server handler. */
export const NATIVE_WORKER_RENDERERS: readonly string[] = ['solid', 'octane'];

/**
 * Read the native worker resources for a built application. Every built entry
 * of the resources' renderer must have validated document inputs.
 */
export async function readNativeRendererWorkerResources(
  distDirectory: string,
  identities: WorkerRendererIdentities | undefined,
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
    value.renderer === 'react' ||
    !isRecord(value.entries)
  )
    throw invalid('unknown schema');
  const entries = value.entries;
  const nativeEntries = Object.entries(identities ?? {}).filter(
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
  return value as unknown as NativeRendererWorkerResources;
}

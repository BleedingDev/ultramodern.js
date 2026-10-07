import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  formatBackendFederationValidationErrors,
  type RendererIdentity,
  validateRendererIdentity,
  validateRendererProfile,
} from '@modern-js/backend-federation-contracts';
import type { DeliveryUnitStamp } from './delivery-unit';
import { isRecord } from './utils';

export type WorkerRendererIdentities = Readonly<
  Record<string, RendererIdentity>
>;

/** The built renderer and how its adapter serves worker documents. */
export interface WorkerRenderer {
  readonly name: string;
  /** Documents come only from the renderer's native server handler. */
  readonly nativeDocuments: boolean;
  readonly rsc: boolean;
}

export interface WorkerRendererBuild {
  readonly renderer: WorkerRenderer;
  readonly identities: WorkerRendererIdentities;
}

/** Bind response metadata to the finalized build and its generated entries. */
export async function readWorkerRendererBuild(
  distDirectory: string,
  routes: readonly {
    entryName?: unknown;
    entryPath?: unknown;
    isApi?: unknown;
    isSSR?: unknown;
    worker?: unknown;
    bundle?: unknown;
    isRSC?: unknown;
    isStream?: unknown;
  }[],
  deliveryUnit?: DeliveryUnitStamp,
): Promise<WorkerRendererBuild | undefined> {
  let bytes: string;
  try {
    bytes = await fs.readFile(
      path.join(distDirectory, 'renderer-build.json'),
      'utf8',
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw error;
  }
  const build: unknown = JSON.parse(bytes);
  if (
    !isRecord(build) ||
    build.schema !== 'ultramodern-renderer-build' ||
    build.version !== 2 ||
    typeof build.buildId !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(build.buildId) ||
    !isRecord(build.profile) ||
    build.renderer !== build.profile.renderer ||
    !isRecord(build.worker) ||
    typeof build.worker.nativeDocuments !== 'boolean' ||
    typeof build.worker.rsc !== 'boolean' ||
    !isRecord(build.entries) ||
    !Object.keys(build.entries).length
  )
    throw new Error(
      'Invalid or outdated renderer-build.json for the Cloudflare worker; rebuild the application.',
    );

  // The SDK profile also carries compiler configuration. Only the neutral
  // renderer protocol fields belong to the worker response binding.
  const { renderer, protocolVersion, compiler, hydration, router } =
    build.profile;
  const validation = validateRendererProfile({
    renderer,
    protocolVersion,
    compiler,
    hydration,
    router,
  });
  if (!validation.ok)
    throw new Error(formatBackendFederationValidationErrors(validation.errors));

  const identities: Record<string, RendererIdentity> = {};
  let appId: string | undefined;
  for (const [entryName, value] of Object.entries(build.entries)) {
    const validation = validateRendererIdentity(value);
    if (!validation.ok)
      throw new Error(
        formatBackendFederationValidationErrors(validation.errors),
      );
    const identity = value as RendererIdentity;
    if (
      entryName === '__proto__' ||
      identity.entryName !== entryName ||
      identity.renderer !== renderer ||
      identity.protocolVersion !== protocolVersion ||
      identity.buildId !== build.buildId ||
      (appId !== undefined && identity.appId !== appId)
    )
      throw new Error(
        'Cloudflare renderer entry identity conflicts with its built manifest',
      );
    appId = identity.appId;
    identities[entryName] = Object.freeze({ ...identity });
  }
  for (const route of routes) {
    // Native public routes name a copied file rather than a renderer entry.
    // Classify the original route shape so application dispatch markers cannot
    // be erased by the worker manifest's normalization.
    if (
      route.isSSR === false &&
      route.entryName === undefined &&
      route.worker === undefined &&
      route.bundle === undefined &&
      (route.isRSC === undefined || route.isRSC === false) &&
      (route.isStream === undefined || route.isStream === false) &&
      typeof route.entryPath === 'string' &&
      route.entryPath.startsWith('public/') &&
      !route.entryPath.includes('\\') &&
      path.posix.normalize(route.entryPath) === route.entryPath
    ) {
      const asset = await fs.stat(path.join(distDirectory, route.entryPath));
      if (asset.isFile()) continue;
    }
    // The BFF prefix route is served by the API worker, never a renderer
    // entry; it carries no document, bundle or dispatch marker.
    if (
      route.isApi === true &&
      route.isSSR === false &&
      route.entryName === undefined &&
      route.entryPath === '' &&
      route.worker === undefined &&
      route.bundle === undefined &&
      (route.isRSC === undefined || route.isRSC === false) &&
      (route.isStream === undefined || route.isStream === false)
    )
      continue;
    if (
      typeof route.entryName !== 'string' ||
      !Object.hasOwn(identities, route.entryName)
    )
      throw new Error(
        `Cloudflare generated route has no built renderer identity for ${String(route.entryName)}`,
      );
  }
  const ui = deliveryUnit?.surfaces.ui;
  if (
    ui &&
    !isDeepStrictEqual(
      identities[ui.rendererIdentity.entryName],
      ui.rendererIdentity,
    )
  )
    throw new Error(
      'Cloudflare built renderer identity conflicts with its finalized delivery unit',
    );
  return Object.freeze({
    renderer: Object.freeze({
      name: renderer as string,
      nativeDocuments: build.worker.nativeDocuments,
      rsc: build.worker.rsc,
    }),
    identities: Object.freeze(identities),
  });
}

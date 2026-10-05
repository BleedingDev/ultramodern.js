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

/** Bind response metadata to the finalized build and its generated entries. */
export async function readWorkerRendererIdentities(
  distDirectory: string,
  routes: readonly { entryName?: unknown }[],
  deliveryUnit?: DeliveryUnitStamp,
): Promise<WorkerRendererIdentities | undefined> {
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
    build.version !== 1 ||
    typeof build.buildMarker !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(build.buildMarker) ||
    !isRecord(build.profile) ||
    !isRecord(build.identities) ||
    !Object.keys(build.identities).length
  )
    throw new Error('Invalid Cloudflare built renderer identity metadata');

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
  for (const [entryName, value] of Object.entries(build.identities)) {
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
      identity.buildId !== build.buildMarker ||
      (appId !== undefined && identity.appId !== appId)
    )
      throw new Error(
        'Cloudflare renderer entry identity conflicts with its built manifest',
      );
    appId = identity.appId;
    identities[entryName] = Object.freeze({ ...identity });
  }
  for (const route of routes) {
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
  return Object.freeze(identities);
}

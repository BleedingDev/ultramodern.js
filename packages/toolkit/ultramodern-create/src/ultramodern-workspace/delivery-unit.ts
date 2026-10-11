import crypto from 'node:crypto';
import {
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
  deliveryUnitContractBlock,
} from '@modern-js/backend-federation-contracts';
import { packageName } from './naming';
import { getRendererGenerationProfile } from './renderer-profile';
import type { WorkspaceApp } from './types';

// The build marker is a DETERMINISTIC identity hash of a delivery unit
// (scope + package + id + version + renderer + entry + ABI profile).
// It must be reproducible across processes:
// the CLI stamps it when generating/adding a unit, and the generated workspace
// validator recomputes it in a separate `pnpm check` process and asserts they
// match. A per-process nonce (Date.now()/randomUUID) made the marker
// un-round-trippable — it only agreed within a single process (e.g. in-process
// unit tests), and always diverged in real CLI→validator usage. Keep this seed
// a stable, versioned namespace constant.
const deliveryUnitGenerationSeed = 'ultramodern-delivery-unit-build-marker:v2';

export function createBuildMarker(
  scope: string,
  app: Pick<
    WorkspaceApp,
    | 'id'
    | 'packageSuffix'
    | 'renderer'
    | 'rendererIdentity'
    | 'rendererProfile'
    | 'routerBindings'
    | 'surfaceProfile'
  >,
  version = '0.1.0',
) {
  const renderer = app.surfaceProfile === 'api-only' ? 'none' : app.renderer;
  if (!renderer) {
    throw new Error(
      `Application ${app.id} requires a resolved renderer profile before its build identity is created.`,
    );
  }
  const profile =
    renderer === 'none'
      ? undefined
      : (app.rendererProfile ?? getRendererGenerationProfile(renderer).profile);
  const rendererPartition = JSON.stringify({
    renderer,
    entryName:
      renderer === 'none'
        ? undefined
        : (app.rendererIdentity?.entryName ?? 'main'),
    protocolVersion: profile?.protocolVersion,
    compiler: profile && [profile.compiler.name, profile.compiler.version],
    hydration: profile && [profile.hydration.name, profile.hydration.version],
    router: profile && [
      profile.router.name,
      profile.router.version,
      profile.router.coreName,
      profile.router.coreVersion,
    ],
    routerBinding:
      renderer === 'none'
        ? undefined
        : app.routerBindings?.[app.rendererIdentity?.entryName ?? 'main'],
  });
  return crypto
    .createHash('sha256')
    .update(
      `${deliveryUnitGenerationSeed}:${scope}:${app.packageSuffix}:${app.id}:${version}:${rendererPartition}`,
    )
    .digest('hex')
    .slice(0, 16);
}

export { deliveryUnitContractBlock };

export function createDeliveryUnitRecord(
  scope: string,
  app: WorkspaceApp,
  version?: string,
): DeliveryUnitRecord {
  const resolvedVersion = version ?? app.deliveryUnit?.version ?? '0.1.0';
  return {
    appId: app.id,
    deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
    kind: DELIVERY_UNIT_KIND,
    packageName: packageName(scope, app.packageSuffix),
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    sourceRevision: 'workspace',
    unitId: `${scope}/${app.domain ?? app.id}`,
    version: resolvedVersion,
    buildMarker: createBuildMarker(scope, app, resolvedVersion),
  };
}

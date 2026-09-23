import crypto from 'node:crypto';
import {
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
  deliveryUnitContractBlock,
} from '@modern-js/backend-federation-contracts';
import { packageName } from './naming';
import type { WorkspaceApp } from './types';

// The build marker is a DETERMINISTIC identity hash of a delivery unit
// (scope + package + id + version). It must be reproducible across processes:
// the CLI stamps it when generating/adding a unit, and the generated workspace
// validator recomputes it in a separate `pnpm check` process and asserts they
// match. A per-process nonce (Date.now()/randomUUID) made the marker
// un-round-trippable — it only agreed within a single process (e.g. in-process
// unit tests), and always diverged in real CLI→validator usage. Keep this seed
// a stable, versioned namespace constant.
const deliveryUnitGenerationSeed = 'ultramodern-delivery-unit-build-marker:v1';

export function createBuildMarker(
  scope: string,
  app: { id: string; packageSuffix: string },
  version = '0.1.0',
) {
  return crypto
    .createHash('sha256')
    .update(
      `${deliveryUnitGenerationSeed}:${scope}:${app.packageSuffix}:${app.id}:${version}`,
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
  const resolvedVersion = version ?? '0.1.0';
  return {
    appId: app.id,
    buildMarker: createBuildMarker(scope, app, resolvedVersion),
    deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
    kind: DELIVERY_UNIT_KIND,
    packageName: packageName(scope, app.packageSuffix),
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    sourceRevision: 'workspace',
    unitId: `${scope}/${app.domain ?? app.id}`,
    version: resolvedVersion,
    ...app.deliveryUnit,
    ...(version === undefined
      ? {}
      : { version, buildMarker: createBuildMarker(scope, app, version) }),
  };
}

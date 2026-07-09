import crypto from 'node:crypto';
import {
  DELIVERY_UNIT_DEPLOY_PROFILE,
  DELIVERY_UNIT_KIND,
  DELIVERY_UNIT_SCHEMA_VERSION,
  type DeliveryUnitRecord,
  deliveryUnitContractBlock,
} from '@modern-js/utils/universal';
import { packageName } from './naming';
import type { WorkspaceApp } from './types';

const deliveryUnitGenerationSeed = `${Date.now()}:${crypto.randomUUID()}`;

export function createBuildMarker(
  scope: string,
  app: { id: string; packageSuffix: string },
) {
  return crypto
    .createHash('sha256')
    .update(
      `${deliveryUnitGenerationSeed}:${scope}:${app.packageSuffix}:${app.id}:0.1.0`,
    )
    .digest('hex')
    .slice(0, 16);
}

export { deliveryUnitContractBlock };

export function createDeliveryUnitRecord(
  scope: string,
  app: WorkspaceApp,
): DeliveryUnitRecord {
  return {
    appId: app.id,
    buildMarker: createBuildMarker(scope, app),
    deployProfile: DELIVERY_UNIT_DEPLOY_PROFILE,
    kind: DELIVERY_UNIT_KIND,
    packageName: packageName(scope, app.packageSuffix),
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    sourceRevision: 'workspace',
    unitId: `${scope}/${app.domain ?? app.id}`,
    version: '0.1.0',
  };
}

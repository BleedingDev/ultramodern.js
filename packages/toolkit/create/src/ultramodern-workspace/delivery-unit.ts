import crypto from 'node:crypto';
import { packageName } from './naming';
import type { WorkspaceApp } from './types';

export const DELIVERY_UNIT_SCHEMA_VERSION = 1;

export type DeliveryUnitRecord = {
  schemaVersion: 1;
  kind: 'microvertical-delivery-unit';
  unitId: string;
  appId: string;
  packageName: string;
  version: string;
  sourceRevision: string;
  buildMarker: string;
  deployProfile: 'cloudflare-ssr-mf-effect-v1';
};

export function createBuildMarker(
  scope: string,
  app: { id: string; packageSuffix: string },
) {
  return crypto
    .createHash('sha256')
    .update(`${scope}:${app.packageSuffix}:${app.id}:0.1.0`)
    .digest('hex')
    .slice(0, 16);
}

export function deliveryUnitContractBlock(record: DeliveryUnitRecord) {
  return {
    schemaVersion: record.schemaVersion,
    kind: record.kind,
    unitId: record.unitId,
    packageName: record.packageName,
    version: record.version,
    buildMarker: record.buildMarker,
    sourceRevision: record.sourceRevision,
  };
}

export function createDeliveryUnitRecord(
  scope: string,
  app: WorkspaceApp,
): DeliveryUnitRecord {
  return {
    schemaVersion: DELIVERY_UNIT_SCHEMA_VERSION,
    kind: 'microvertical-delivery-unit',
    unitId: `${scope}/${app.domain ?? app.id}`,
    appId: app.id,
    packageName: packageName(scope, app.packageSuffix),
    version: '0.1.0',
    sourceRevision: 'workspace',
    buildMarker: createBuildMarker(scope, app),
    deployProfile: 'cloudflare-ssr-mf-effect-v1',
  };
}

import { createBackendFederationContract } from './backend-federation';
import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from './delivery-unit';
import type { WorkspaceApp } from './types';

export function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stamp one topology app with identity derived from its package manifest. */
export function stampDeliveryUnitIdentity(
  entry: Record<string, any>,
  scope: string,
  app: WorkspaceApp,
  version: string,
): void {
  const block = {
    ...(isPlainObject(entry.deliveryUnit) ? entry.deliveryUnit : {}),
    ...deliveryUnitContractBlock(createDeliveryUnitRecord(scope, app, version)),
  };

  entry.deliveryUnit = block;

  if (isPlainObject(entry.backendFederation)) {
    entry.backendFederation.deliveryUnit = {
      ...(isPlainObject(entry.backendFederation.deliveryUnit)
        ? entry.backendFederation.deliveryUnit
        : {}),
      ...block,
    };
    if (!isPlainObject(entry.backendFederation.versionBoundary)) {
      entry.backendFederation.versionBoundary = {};
    }
    entry.backendFederation.versionBoundary.identityRoot = 'deliveryUnit';
    return;
  }

  const contract = createBackendFederationContract(scope, {
    ...app,
    deliveryUnit: { ...app.deliveryUnit, ...block },
  });
  if (contract !== undefined) {
    entry.backendFederation = contract;
  }
}

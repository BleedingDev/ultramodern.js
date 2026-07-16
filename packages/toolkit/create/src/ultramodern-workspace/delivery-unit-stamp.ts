import { createBackendFederationContract } from './backend-federation';
import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from './delivery-unit';
import type { WorkspaceApp } from './types';

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Stamp one compact-config or reference-topology app with canonical identity. */
export function stampDeliveryUnitIdentity(
  entry: Record<string, any>,
  scope: string,
  app: WorkspaceApp,
): void {
  const block = deliveryUnitContractBlock(createDeliveryUnitRecord(scope, app));

  entry.deliveryUnit = block;

  if (isPlainObject(entry.backendFederation)) {
    entry.backendFederation.deliveryUnit = block;
    if (!isPlainObject(entry.backendFederation.versionBoundary)) {
      entry.backendFederation.versionBoundary = {};
    }
    entry.backendFederation.versionBoundary.identityRoot = 'deliveryUnit';
    return;
  }

  const contract = createBackendFederationContract(scope, app);
  if (contract !== undefined) {
    entry.backendFederation = contract;
  }
}

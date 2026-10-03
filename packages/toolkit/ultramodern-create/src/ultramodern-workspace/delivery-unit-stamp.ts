import { createBackendFederationContract } from './backend-federation';
import {
  createBuildMarker,
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from './delivery-unit';
import {
  type RendererMetadataPhase,
  rendererMetadataProjection,
} from './renderer-identity';
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
  phase: RendererMetadataPhase = 'resolved',
): void {
  const record = createDeliveryUnitRecord(scope, app, version);
  const rendererIdentities =
    app.rendererIdentities &&
    Object.fromEntries(
      Object.entries(app.rendererIdentities).map(([entryName, identity]) => [
        entryName,
        {
          ...identity,
          buildId: createBuildMarker(
            scope,
            { ...app, rendererIdentity: identity },
            version,
          ),
        },
      ]),
    );
  const projection = rendererMetadataProjection(
    {
      ...app,
      deliveryUnit: record,
      ...(app.rendererIdentity
        ? {
            rendererIdentity: {
              ...app.rendererIdentity,
              buildId: record.buildMarker,
            },
          }
        : {}),
      ...(rendererIdentities ? { rendererIdentities } : {}),
    },
    phase,
  );
  entry.renderer = projection.renderer;
  delete entry.rendererGenerationProfile;
  for (const field of [
    'rendererIdentity',
    'rendererIdentities',
    'rendererProfile',
    'routerBindings',
    'rendererCapabilities',
  ]) {
    if (!Object.hasOwn(projection, field)) delete entry[field];
  }
  Object.assign(entry, projection);
  if (!projection.rendererCapabilities?.federation) {
    for (const field of [
      'moduleFederation',
      'moduleFederationName',
      'mfName',
      'exposes',
      'verticalRefs',
    ])
      delete entry[field];
  }
  if (
    projection.renderer !== 'none' &&
    !projection.rendererCapabilities?.workers
  )
    delete entry.cloudflare;
  const block = {
    ...(isPlainObject(entry.deliveryUnit) ? entry.deliveryUnit : {}),
    ...deliveryUnitContractBlock(record),
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
    const node = entry.backendFederation.executionSurfaces?.node;
    if (isPlainObject(node)) {
      node.expected = {
        ...(isPlainObject(node.expected) ? node.expected : {}),
        unitId: record.unitId,
        buildMarker: record.buildMarker,
      };
    }
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

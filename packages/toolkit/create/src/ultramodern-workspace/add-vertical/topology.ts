import path from 'node:path';
import { apiTopologyMetadata } from '../api';
import { createBackendFederationContract } from '../backend-federation';
import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from '../delivery-unit';
import {
  createModuleFederationRemoteContracts,
  createNeutralOwnership,
  shellApp,
} from '../descriptors';
import { packageName, toEnvSegment, toPascalCase } from '../naming';
import { createCloudflareDeployContract } from '../policy';
import type {
  JsonValue,
  Ownership,
  WorkspaceApi,
  WorkspaceApp,
} from '../types';

export function verticalTopologyEntry(
  scope: string,
  vertical: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  const backendFederation = createBackendFederationContract(scope, vertical);

  return {
    id: vertical.id,
    kind: vertical.kind,
    ...(vertical.domain ? { domain: vertical.domain } : {}),
    package: packageName(scope, vertical.packageSuffix),
    path: vertical.directory,
    moduleFederation: {
      role: 'remote',
      name: vertical.mfName,
      manifestUrl: `http://localhost:${vertical.port}/mf-manifest.json`,
      exposes: Object.keys(vertical.exposes ?? {}),
      ...(vertical.verticalRefs?.length
        ? {
            verticalRefs: vertical.verticalRefs,
            remotes: createModuleFederationRemoteContracts(vertical, remotes),
          }
        : {}),
      ssr: true,
      sharedContractVersion: 'mf-ssr-contract-v1',
    },
    ...(backendFederation ? { backendFederation } : {}),
    ...(vertical.api
      ? {
          deliveryUnit: deliveryUnitContractBlock(
            createDeliveryUnitRecord(scope, vertical),
          ),
        }
      : {}),
    ...(apiTopologyMetadata(vertical)
      ? { api: apiTopologyMetadata(vertical) }
      : {}),
    cloudflare: createCloudflareDeployContract(scope, vertical),
    ownership: vertical.ownership,
  };
}

export function ownershipEntry(
  scope: string,
  owner: {
    id: string;
    packageSuffix: string;
    directory: string;
    ownership: Ownership;
  },
): JsonValue {
  return {
    id: owner.id,
    package: packageName(scope, owner.packageSuffix),
    path: owner.directory,
    ownership: owner.ownership,
  };
}

export function verticalsFromTopology(
  topology: Record<string, any>,
  ports: Record<string, unknown>,
) {
  return (topology.verticals ?? []).map((vertical: any) => {
    const domain = vertical.domain ?? String(vertical.id);
    const packageSuffix = vertical.package?.split('/').at(-1) ?? domain;
    const apiTopology = vertical.api;
    const api =
      apiTopology?.runtime === 'effect'
        ? ({
            stem:
              typeof apiTopology.basePath === 'string'
                ? (apiTopology.basePath.split('/').filter(Boolean).at(-1) ??
                  domain)
                : domain,
            prefix: apiTopology.bff?.prefix ?? `/${domain}-api`,
            consumedBy: Array.isArray(apiTopology.consumedBy)
              ? apiTopology.consumedBy
              : [shellApp.id, vertical.id],
          } satisfies WorkspaceApi)
        : undefined;

    return {
      id: vertical.id,
      directory:
        typeof vertical.path === 'string'
          ? vertical.path
          : `verticals/${domain}`,
      packageSuffix,
      displayName: vertical.displayName ?? `${toPascalCase(domain)} Vertical`,
      kind: 'vertical',
      domain,
      portEnv: `VERTICAL_${toEnvSegment(domain)}_PORT`,
      port: typeof ports[vertical.id] === 'number' ? ports[vertical.id] : 0,
      mfName:
        vertical.moduleFederation?.name ?? `vertical${toPascalCase(domain)}`,
      ...(Array.isArray(vertical.moduleFederation?.exposes)
        ? {
            exposes: Object.fromEntries(
              vertical.moduleFederation.exposes.map((expose: string) => [
                expose,
                expose === './Route'
                  ? './src/federation-entry.tsx'
                  : expose === './Widget'
                    ? `./src/components/${domain}-widget.tsx`
                    : '',
              ]),
            ),
          }
        : {}),
      ...(Array.isArray(vertical.moduleFederation?.verticalRefs)
        ? { verticalRefs: vertical.moduleFederation.verticalRefs }
        : Array.isArray(vertical.moduleFederation?.remotes)
          ? {
              verticalRefs: vertical.moduleFederation.remotes
                .map((entry: any) => entry.id)
                .filter((id: unknown): id is string => typeof id === 'string'),
            }
          : {}),
      ...(api ? { api } : {}),
      ownership: vertical.ownership ?? createNeutralOwnership(vertical.id),
    };
  }) as WorkspaceApp[];
}

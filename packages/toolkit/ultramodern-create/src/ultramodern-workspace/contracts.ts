import { apiTopologyMetadata } from './api';
import { rpcPath } from './api/rpc';
import {
  createBackendFederationContract,
  createServerExecutionOverlay,
} from './backend-federation';
import {
  createDeliveryUnitRecord,
  deliveryUnitContractBlock,
} from './delivery-unit';
import {
  appEmitsBrowserUi,
  createModuleFederationRemoteContracts,
  createShellHost,
  resolveApiPrefix,
  resolveApiProtocol,
  sharedPackages,
  shellApp,
  verticalApiApps,
} from './descriptors';
import { packageName } from './naming';
import { createCloudflareDeployContract } from './policy';
import type { JsonValue, WorkspaceApp } from './types';

function isJsonValue(value: JsonValue | undefined): value is JsonValue {
  return value !== undefined;
}

function optionalJsonEntry(
  key: string,
  value: JsonValue | undefined,
): Record<string, JsonValue> {
  return value === undefined ? {} : { [key]: value };
}

function jsonEntries(
  entries: [string, JsonValue | undefined][],
): Record<string, JsonValue> {
  return Object.fromEntries(
    entries.filter((entry): entry is [string, JsonValue] =>
      isJsonValue(entry[1]),
    ),
  );
}

function createReferenceRemoteContracts(
  app: WorkspaceApp,
  remotes: WorkspaceApp[],
) {
  return createModuleFederationRemoteContracts(app, remotes).map(remote => ({
    id: remote.id,
    name: remote.name,
    manifestUrl: remote.manifestUrl,
  }));
}

export function createTopology(
  scope: string,
  remotes: WorkspaceApp[] = [],
  primaryShell?: WorkspaceApp,
): JsonValue {
  const shellHost = primaryShell ?? createShellHost(remotes);
  return {
    schemaVersion: 1,
    id: 'ultramodern-superapp-workspace-reference-topology',
    description:
      'Generated UltraModern SuperApp shell that can grow by adding full-stack verticals.',
    preset: 'presetUltramodern',
    shell: {
      id: shellHost.id,
      kind: 'shell',
      package: packageName(scope, shellHost.packageSuffix),
      path: shellHost.directory,
      displayName: shellHost.displayName,
      portEnv: shellHost.portEnv,
      verticalRefs: shellHost.verticalRefs ?? [],
      moduleFederation: {
        role: 'host',
        name: shellHost.mfName,
        remotes: createReferenceRemoteContracts(shellHost, remotes),
        ssr: true,
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      // Every unit kind carries a delivery-unit identity (G29): the shell is
      // its own delivery unit even though it has no API surface.
      deliveryUnit: deliveryUnitContractBlock(
        createDeliveryUnitRecord(scope, shellHost),
      ),
      cloudflare: createCloudflareDeployContract(scope, shellHost),
      ownership: shellHost.ownership,
    },
    verticals: remotes.map(vertical => ({
      id: vertical.id,
      kind: vertical.kind,
      ...(vertical.surfaceProfile
        ? { surfaceProfile: vertical.surfaceProfile }
        : {}),
      ...(vertical.deliveryUnitKind
        ? { deliveryUnitKind: vertical.deliveryUnitKind }
        : {}),
      ...(vertical.domain ? { domain: vertical.domain } : {}),
      package: packageName(scope, vertical.packageSuffix),
      path: vertical.directory,
      displayName: vertical.displayName,
      portEnv: vertical.portEnv,
      moduleFederation: {
        role: 'remote',
        name: vertical.mfName,
        manifestUrl: `http://localhost:${vertical.port}/mf-manifest.json`,
        exposes: Object.keys(vertical.exposes ?? {}),
        ...(vertical.verticalRefs?.length
          ? {
              verticalRefs: vertical.verticalRefs,
              remotes: createReferenceRemoteContracts(vertical, remotes),
            }
          : {}),
        ssr: true,
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      ...optionalJsonEntry(
        'backendFederation',
        createBackendFederationContract(scope, vertical),
      ),
      // Delivery-unit identity for ALL unit kinds (G29): UI-only verticals
      // are delivery units too, not just API-bearing ones. The key keeps the
      // exact position it had for API-bearing verticals.
      deliveryUnit: deliveryUnitContractBlock(
        createDeliveryUnitRecord(scope, vertical),
      ),
      ...optionalJsonEntry('api', apiTopologyMetadata(vertical)),
      cloudflare: createCloudflareDeployContract(scope, vertical),
      ownership: vertical.ownership,
    })),
    sharedPackages: sharedPackages.map(sharedPackage => ({
      id: sharedPackage.id,
      package: packageName(scope, sharedPackage.id),
      path: sharedPackage.directory,
      description: sharedPackage.description,
    })),
  };
}

export function createOwnership(
  scope: string,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  return {
    schemaVersion: 1,
    preset: 'presetUltramodern',
    owners: [
      shellApp,
      ...remotes,
      ...sharedPackages.map(sharedPackage => ({
        id: sharedPackage.id,
        packageSuffix: sharedPackage.id,
        directory: sharedPackage.directory,
        ownership: {
          team: 'super-app-platform',
          slack: '#super-app-platform',
          pagerDuty: 'pd-super-app-platform',
          runbookRef: `runbooks/wave2/${sharedPackage.id}.md`,
          adrRef:
            'docs/super-app-rfc-adr/wave2/reference-topology.md#shared-packages',
          blastRadius: {
            tier: 'tier-1-shared-contract',
            references: [
              'docs/super-app-rfc-adr/wave2/blast-radius.md#shared-packages',
            ],
          },
        },
      })),
    ].map(owner => ({
      id: owner.id,
      package: packageName(scope, owner.packageSuffix),
      path: owner.directory,
      ownership: owner.ownership,
    })),
  };
}

export function createDevelopmentOverlay(
  scope: string,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  return {
    schemaVersion: 1,
    environment: 'development',
    preset: 'presetUltramodern',
    ports: Object.fromEntries(
      [shellApp, ...remotes].map(app => [app.id, app.port]),
    ),
    manifests: Object.fromEntries(
      remotes
        .filter(appEmitsBrowserUi)
        .map(remote => [
          remote.id,
          `http://localhost:${remote.port}/mf-manifest.json`,
        ]),
    ),
    serverExecution: jsonEntries(
      verticalApiApps(remotes).map(app => [
        app.id,
        createServerExecutionOverlay(scope, app),
      ]),
    ),
    apis: Object.fromEntries(
      verticalApiApps(remotes).map(app => [
        app.id,
        `http://localhost:${app.port}${
          resolveApiProtocol(app) === 'rpc'
            ? rpcPath(app)
            : resolveApiPrefix(app)
        }`,
      ]),
    ),
  };
}

import { apiTopologyMetadata } from './api';
import { rpcPath } from './api/rpc';
import {
  createBackendFederationContract,
  createBackendFederationSummary,
  createServerExecutionOverlay,
} from './backend-federation';
import type { UltramodernBridgeConfig } from './bridge-config';
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
import { createAdditionalShellConfigEntry } from './shells';
import { createGeneratedToolingWrapperMap } from './tooling-command-catalog';
import type { JsonValue, ResolvedPackageSource, WorkspaceApp } from './types';
import {
  CLOUDFLARE_COMPATIBILITY_DATE,
  NODE_VERSION,
  PNPM_VERSION,
} from './versions';

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

function presentJsonValues(values: (JsonValue | undefined)[]): JsonValue[] {
  return values.filter(isJsonValue);
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
      id: shellApp.id,
      kind: 'shell',
      package: packageName(scope, shellApp.packageSuffix),
      verticalRefs: shellHost.verticalRefs ?? [],
      moduleFederation: {
        role: 'host',
        name: shellApp.mfName,
        remotes: createReferenceRemoteContracts(shellHost, remotes),
        ssr: true,
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      // Every unit kind carries a delivery-unit identity (G29): the shell is
      // its own delivery unit even though it has no API surface.
      deliveryUnit: deliveryUnitContractBlock(
        createDeliveryUnitRecord(scope, shellApp),
      ),
      cloudflare: createCloudflareDeployContract(scope, shellApp),
      ownership: shellApp.ownership,
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
    validation: {
      script: 'scripts/validate-ultramodern-workspace.mts',
      commands: [
        'pnpm i18n:boundaries',
        'pnpm api:check',
        'pnpm contract:check',
      ],
    },
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

export function createUltramodernConfig(
  scope: string,
  modernVersion: string,
  packageSource: ResolvedPackageSource,
  apps: WorkspaceApp[] = [createShellHost()],
  enableTailwind = true,
  bridge?: UltramodernBridgeConfig,
  additionalShells: WorkspaceApp[] = [],
  primaryShell?: WorkspaceApp,
): JsonValue {
  const remotes = apps.filter(app => app.kind !== 'shell');
  const shellHost = primaryShell ?? createShellHost(remotes);

  return {
    schemaVersion: 1,
    profile: 'cloudflare-ssr-mf-effect-v1',
    generator: {
      package: '@modern-js/create',
      version: modernVersion,
    },
    workspace: {
      packageScope: scope,
      packageManager: {
        name: 'pnpm',
        version: PNPM_VERSION,
      },
      node: {
        version: NODE_VERSION,
        engineRange: '>=26',
      },
    },
    packageSource: {
      strategy: packageSource.strategy,
      modernPackageVersion: packageSource.modernPackageVersion,
      ...(packageSource.registry ? { registry: packageSource.registry } : {}),
      ...(packageSource.aliasScope
        ? { aliasScope: packageSource.aliasScope }
        : {}),
      ...(packageSource.aliasPackageNamePrefix
        ? { aliasPackageNamePrefix: packageSource.aliasPackageNamePrefix }
        : {}),
    },
    features: {
      tailwind: enableTailwind,
    },
    topology: {
      source: './topology/reference-topology.json',
      apps: apps.map(app => ({
        id: app.id,
        kind: app.kind,
        package: packageName(scope, app.packageSuffix),
        packageSuffix: app.packageSuffix,
        displayName: app.displayName,
        path: app.directory,
        ...(app.domain ? { domain: app.domain } : {}),
        ...(app.surfaceProfile ? { surfaceProfile: app.surfaceProfile } : {}),
        ...(app.deliveryUnitKind
          ? { deliveryUnitKind: app.deliveryUnitKind }
          : {}),
        port: app.port,
        portEnv: app.portEnv,
        moduleFederation: {
          role: app.kind === 'shell' ? 'host' : 'remote',
          name: app.mfName,
          exposes: Object.keys(app.exposes ?? {}),
          ...(app.kind === 'shell'
            ? {
                verticalRefs: shellHost.verticalRefs ?? [],
                remotes: createModuleFederationRemoteContracts(
                  shellHost,
                  remotes,
                ),
              }
            : app.verticalRefs?.length
              ? {
                  verticalRefs: app.verticalRefs,
                  remotes: createModuleFederationRemoteContracts(app, remotes),
                }
              : {}),
          ssr: true,
          dts: {
            compilerInstance: 'effect-tsgo',
            tsConfigPath: './tsconfig.mf-types.json',
          },
        },
        ...optionalJsonEntry(
          'backendFederation',
          createBackendFederationContract(scope, app),
        ),
        // Delivery-unit identity for ALL unit kinds (G29): shell and UI-only
        // verticals carry the record too; API-bearing apps keep the same key
        // position, so their output is unchanged.
        deliveryUnit: deliveryUnitContractBlock(
          createDeliveryUnitRecord(scope, app),
        ),
        ...(app.api
          ? {
              api: {
                runtime: 'effect',
                stem: app.api.stem,
                prefix: app.api.prefix,
                consumedBy: app.api.consumedBy,
                serverEntry: `${app.directory}/api/index.ts`,
                ...(app.api.protocol === undefined
                  ? {}
                  : { protocol: app.api.protocol }),
              },
            }
          : {}),
      })),
    },
    ...(additionalShells.length > 0
      ? {
          shells: additionalShells.map(shell =>
            createAdditionalShellConfigEntry(scope, shell, remotes),
          ),
        }
      : {}),
    bridge: bridge ?? {
      enabled: false,
      workspacePackages: [],
      dependencies: [],
      lockfilePolicy: 'nested',
      gates: [],
      reactSingletons: ['react', 'react-dom'],
    },
    deploy: {
      worker: {
        wrangler: {
          compatibility_date: CLOUDFLARE_COMPATIBILITY_DATE,
          compatibility_flags: [
            'nodejs_compat',
            'global_fetch_strictly_public',
          ],
        },
        artifacts: [],
        publicAssetExcludes: [],
      },
    },
    moduleFederation: {
      apps: apps.map(app => ({
        id: app.id,
        path: app.directory,
        role: app.kind === 'shell' ? 'host' : 'remote',
        name: app.mfName,
        exposes: Object.keys(app.exposes ?? {}),
        hostOnly:
          app.kind === 'shell' && Object.keys(app.exposes ?? {}).length === 0,
      })),
    },
    backendFederation: {
      apps: presentJsonValues(
        verticalApiApps(remotes).map(app =>
          createBackendFederationSummary(scope, app),
        ),
      ),
    },
    agentSkills: {
      target: 'codex',
      // Fresh scaffolds default to .codex/; the generated bootstrap script and
      // validator also accept .agents/skills-lock.json for agents-standard layouts.
      lockfile: './.codex/skills-lock.json',
      installDir: './.codex/skills',
      mode: 'repo-owned-default-on',
      selfContainedVendoring: true,
      optOutEnv: [
        'ULTRAMODERN_SKIP_CODEX_SKILLS=1',
        'ULTRAMODERN_CODEX_SKILLS=0',
      ],
    },
    tooling: {
      command: 'modern-js-create ultramodern',
      wrappers: {
        ...createGeneratedToolingWrapperMap(),
        apiBoundaries: 'scripts/check-ultramodern-api-boundaries.mts',
        skills: 'scripts/bootstrap-agent-skills.mts',
      },
    },
  };
}

import type { UltramodernBridgeConfig } from './bridge-config';
import {
  createModuleFederationRemoteContracts,
  createShellHost,
  effectApiPrefix,
  sharedPackages,
  shellApp,
  verticalEffectApps,
} from './descriptors';
import { effectApiTopologyMetadata } from './effect-api';
import { packageName } from './naming';
import { createCloudflareDeployContract } from './policy';
import type { JsonValue, ResolvedPackageSource, WorkspaceApp } from './types';
import {
  CLOUDFLARE_COMPATIBILITY_DATE,
  NODE_VERSION,
  PNPM_VERSION,
} from './versions';

export function createTopology(
  scope: string,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  const shellHost = createShellHost(remotes);
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
      verticalRefs: shellHost.verticalRefs,
      moduleFederation: {
        role: 'host',
        name: shellApp.mfName,
        remotes: createModuleFederationRemoteContracts(shellHost, remotes),
        ssr: true,
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      cloudflare: createCloudflareDeployContract(scope, shellApp),
      ownership: shellApp.ownership,
    },
    verticals: remotes.map(vertical => ({
      id: vertical.id,
      kind: vertical.kind,
      domain: vertical.domain,
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
              remotes: createModuleFederationRemoteContracts(vertical),
            }
          : {}),
        ssr: true,
        fallbackTelemetryEvent: 'modernjs:mv-runtime-parity',
        sharedContractVersion: 'mf-ssr-contract-v1',
      },
      ...(effectApiTopologyMetadata(vertical)
        ? { api: effectApiTopologyMetadata(vertical) }
        : {}),
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
      script: 'scripts/validate-ultramodern-workspace.mjs',
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
      remotes.map(remote => [
        remote.id,
        `http://localhost:${remote.port}/mf-manifest.json`,
      ]),
    ),
    apis: Object.fromEntries(
      verticalEffectApps(remotes).map(app => [
        app.id,
        `http://localhost:${app.port}${effectApiPrefix(app)}`,
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
): JsonValue {
  const remotes = apps.filter(app => app.kind !== 'shell');
  const shellHost = createShellHost(remotes);

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
        port: app.port,
        portEnv: app.portEnv,
        moduleFederation: {
          role: app.kind === 'shell' ? 'host' : 'remote',
          name: app.mfName,
          exposes: Object.keys(app.exposes ?? {}),
          ...(app.kind === 'shell'
            ? {
                verticalRefs: shellHost.verticalRefs,
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
            compilerInstance: 'tsgo',
            tsConfigPath: './tsconfig.mf-types.json',
          },
        },
        ...(app.effectApi
          ? {
              effectApi: {
                stem: app.effectApi.stem,
                prefix: app.effectApi.prefix,
                consumedBy: app.effectApi.consumedBy,
              },
            }
          : {}),
      })),
    },
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
    agentSkills: {
      target: 'codex',
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
        validate: 'scripts/validate-ultramodern-workspace.mjs',
        typecheck: 'scripts/ultramodern-typecheck.mjs',
        mfTypes: 'scripts/assert-mf-types.mjs',
        publicSurface: 'scripts/generate-public-surface-assets.mjs',
        cloudflareProof: 'scripts/proof-cloudflare-version.mjs',
        performanceReadiness: 'scripts/ultramodern-performance-readiness.mjs',
        apiBoundaries: 'scripts/check-ultramodern-api-boundaries.mjs',
        skills: 'scripts/bootstrap-agent-skills.mjs',
      },
    },
  };
}

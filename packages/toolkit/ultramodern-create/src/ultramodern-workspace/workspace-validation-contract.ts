import { ULTRAMODERN_CREATE_PACKAGE } from '../ultramodern-package-source';
import type { UltramodernReleaseCohort } from '../ultramodern-release-cohort';
import { verticalApiGroupName } from './api';
import { createBackendFederationMetadata } from './backend-federation';
import {
  createDevelopmentOverlay,
  createOwnership,
  createTopology,
  createUltramodernConfig,
} from './contracts';
import { createDeliveryUnitRecord } from './delivery-unit';
import { remoteComponentOutputPath } from './demo-components';
import {
  appEmitsBrowserUi,
  appHasApi,
  appI18nNamespace,
  createShellHost,
  remoteDependencyAlias,
  resolveApiProtocol,
  resolveApiStem,
  sharedPackages,
  shellApp,
} from './descriptors';
import { packageName, tailwindPrefixForApp } from './naming';
import { createCloudflareSecurityContract } from './policy';
import { publicSurfaceManagedSourceAssetPaths } from './public-surface';
import {
  createLocalisedUrlsMap,
  createRouteMetaFilePath,
  createRouteOwnedI18nPaths,
  createRoutePageFilePath,
} from './routes';
import {
  createAdditionalShellConfigEntry,
  shellDeliveryUnitBlock,
} from './shells';
import type { WorkspaceApp } from './types';
import { resolveOwnerAttribution } from './types';
import {
  CLOUDFLARE_COMPATIBILITY_DATE,
  EFFECT_VERSION,
  EFFECT_VITEST_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
  TANSTACK_HISTORY_VERSION,
} from './versions';
import {
  createWorkspaceRootPackageScripts,
  createWorkspaceRootScriptPlan,
} from './workspace-script-plan';

const WORKSPACE_VALIDATION_CONTRACT_SCHEMA_VERSION = 2;
const WORKSPACE_METADATA_SCHEMA_VERSION = 1;
const WORKSPACE_VALIDATION_CONTRACT_KIND =
  'modernjs.ultramodern-workspace-validation-contract';

const modernPackageCohort = [
  ULTRAMODERN_CREATE_PACKAGE,
  '@modern-js/code-tools',
  '@modern-js/app-tools',
  '@modern-js/plugin-bff',
  '@modern-js/plugin-i18n',
  '@modern-js/plugin-tanstack',
  '@modern-js/runtime',
] as const;

type JsonRecord = Record<string, unknown>;

const asJsonRecord = (value: unknown): JsonRecord => value as JsonRecord;

function projectModuleFederationMetadata(value: unknown) {
  const moduleFederation = asJsonRecord(value);

  return {
    ...moduleFederation,
    ...(Array.isArray(moduleFederation.remotes)
      ? {
          remotes: moduleFederation.remotes.map(value => {
            const remote = asJsonRecord(value);
            return {
              id: remote.id,
              manifestUrl: remote.manifestUrl,
              name: remote.name,
            };
          }),
        }
      : {}),
  };
}

function createReferenceTopologyExpectation(
  scope: string,
  remotes: WorkspaceApp[],
  primaryShell?: WorkspaceApp,
) {
  const topology = asJsonRecord(createTopology(scope, remotes, primaryShell));
  const shell = asJsonRecord(topology.shell);

  return {
    ...topology,
    shell: {
      ...shell,
      moduleFederation: projectModuleFederationMetadata(shell.moduleFederation),
    },
    verticals: Array.isArray(topology.verticals)
      ? topology.verticals.map(value => {
          const vertical = asJsonRecord(value);
          return {
            ...vertical,
            moduleFederation: projectModuleFederationMetadata(
              vertical.moduleFederation,
            ),
          };
        })
      : topology.verticals,
  };
}

const validationEvidencePolicy = {
  schemaVersion: 1,
  required: [
    { id: 'typescript-compiler', kind: 'compiler' },
    { id: 'architecture-compiler', kind: 'compiler' },
    { id: 'executable-modern-config', kind: 'runtime' },
    { id: 'executable-runtime-config', kind: 'runtime' },
    { id: 'executable-module-federation-config', kind: 'runtime' },
    { id: 'executable-build-facade', kind: 'runtime' },
    { id: 'structured-package-config', kind: 'structured' },
    { id: 'structured-deploy-config', kind: 'structured' },
    { id: 'public-behavior-gates', kind: 'behavior' },
  ],
} as const;

type WorkspaceValidationContract = ReturnType<
  typeof createWorkspaceValidationContract
>;

/**
 * Structured thin-shell gate (G30a). A Shell is a thin composition host: it
 * owns top-level routing, provisions the Platform Baseline, and composes
 * MicroVertical surfaces without owning business capability. The contract
 * carries filesystem topology and shell descriptors; compiler-backed
 * architecture diagnostics enforce published package and Module Federation
 * boundaries without generated-source token matching.
 *
 * The generated validator enforces this block for every configured shell.
 */
function createStructuralShellPolicy(workspaceApps: WorkspaceApp[]) {
  return {
    schemaVersion: 1,
    shells: workspaceApps
      .filter(app => app.kind === 'shell')
      .map(app => ({
        id: app.id,
        packageDir: app.directory,
        srcDir: `${app.directory}/src`,
      })),
    forbiddenPathClasses: [
      {
        id: 'shell-api-surface',
        path: 'api',
        diagnostic:
          'A thin Shell must not own an API surface (api/); business APIs belong to a MicroVertical.',
      },
      {
        id: 'shell-server-surface',
        path: 'server',
        diagnostic:
          'A thin Shell must not own a server surface (server/); server capability belongs to a MicroVertical.',
      },
      {
        id: 'shell-backend-federation',
        path: 'backend-federation.config.ts',
        diagnostic:
          'A thin Shell must not own backend-federation artifacts; backend federation belongs to a MicroVertical delivery unit.',
      },
    ],
  };
}

function createFederatedCompositionPolicy(
  scope: string,
  hosts: WorkspaceApp[],
  remotes: WorkspaceApp[],
) {
  const remotesById = new Map(remotes.map(remote => [remote.id, remote]));

  return {
    schemaVersion: 1,
    hosts: [...new Map(hosts.map(host => [host.id, host])).values()]
      .filter(host => (host.verticalRefs?.length ?? 0) > 0)
      .map(host => ({
        id: host.id,
        srcDir: `${host.directory}/src`,
        remotes: (host.verticalRefs ?? []).map(remoteId => {
          const remote = remotesById.get(remoteId);
          if (remote === undefined) {
            throw new Error(
              `Unknown remote vertical reference ${remoteId} for ${host.id}.`,
            );
          }
          return {
            id: remote.id,
            directory: remote.directory,
            packageName: packageName(scope, remote.packageSuffix),
          };
        }),
      })),
  };
}

export function createWorkspaceValidationContract(
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
  releaseCohort?: UltramodernReleaseCohort,
  additionalShells: WorkspaceApp[] = [],
  primaryShell?: WorkspaceApp,
  compactConfigOverride?: Record<string, unknown>,
  ownershipOverride?: Record<string, unknown>,
  developmentOverlayOverride?: Record<string, unknown>,
) {
  const resolvedPrimaryShell = primaryShell ?? createShellHost(remotes);
  const workspaceApps = [resolvedPrimaryShell, ...remotes];
  // All configured shells (primary + additional, G28) are enumerated by the
  // root scripts and gated by the structural thin-shell rules. Additional
  // shells are deliberately kept out of the strict app/manifest cohort so the
  // primary topology.apps cohort stays byte-identical for a single-shell
  // workspace.
  const configuredShells = [resolvedPrimaryShell, ...additionalShells];
  const compactConfig = asJsonRecord(
    compactConfigOverride ??
      createUltramodernConfig(
        scope,
        'workspace-validation-contract',
        {
          strategy: 'workspace',
          modernPackageVersion: 'workspace:*',
        },
        workspaceApps,
        enableTailwind,
        undefined,
        additionalShells,
        resolvedPrimaryShell,
      ),
  );
  const fullStackVerticals = remotes.map(remote => ({
    id: remote.id,
    domain: remote.domain,
    path: remote.directory,
    port: remote.port,
    mfName: remote.mfName,
    // Profile + protocol markers consumed by the generated validator's
    // required/forbidden-file gates and generated-contract api assertions.
    // UI-only verticals (Horizontal Remote) carry no API surface (G2a/P4), so
    // their api-specific fields are omitted; api-bearing verticals keep them.
    emitsApi: appHasApi(remote),
    emitsUi: appEmitsBrowserUi(remote),
    surfaceProfile: remote.surfaceProfile ?? 'full-stack',
    ...(appHasApi(remote)
      ? {
          stem: remote.api.stem,
          group: verticalApiGroupName(remote),
          apiPrefix: remote.api.prefix,
          apiProtocol: resolveApiProtocol(remote),
          apiContractExport: './api',
          apiClientExport:
            resolveApiProtocol(remote) === 'rpc'
              ? './api/rpc-client'
              : './api/client',
          apiContractPath:
            resolveApiProtocol(remote) === 'rpc'
              ? 'shared/rpc.ts'
              : 'shared/api.ts',
          apiClientPath: `src/api/${resolveApiStem(remote)}-${
            resolveApiProtocol(remote) === 'rpc' ? 'rpc-client' : 'client'
          }.ts`,
          backendFederation: createBackendFederationMetadata(scope, remote),
        }
      : {}),
    tailwindPrefix: tailwindPrefixForApp(remote),
    zephyrAlias: remoteDependencyAlias(remote),
    packageName: packageName(scope, remote.packageSuffix),
    deliveryUnit: createDeliveryUnitRecord(scope, remote),
    exposes: Object.keys(remote.exposes ?? {}),
    componentPaths: Object.keys(remote.exposes ?? {})
      .map(expose => remoteComponentOutputPath(remote, expose))
      .filter((componentPath): componentPath is string =>
        Boolean(componentPath),
      ),
    namespace: appI18nNamespace(remote),
    routePagePaths: createRouteOwnedI18nPaths(remote)
      .filter(route => route.canonicalPath !== '/')
      .map(route => createRoutePageFilePath(remote, route.canonicalPath)),
    routeMetaPaths: createRouteOwnedI18nPaths(remote).map(route =>
      createRouteMetaFilePath(remote, route.canonicalPath),
    ),
    localisedUrls: createLocalisedUrlsMap(remote),
    verticalRefs: remote.verticalRefs ?? [],
  }));
  const additionalShellRecords = additionalShells.map(shell => {
    const configEntry = createAdditionalShellConfigEntry(scope, shell, remotes);
    return {
      id: shell.id,
      path: shell.directory,
      packageName: packageName(scope, shell.packageSuffix),
      port: shell.port,
      portEnv: shell.portEnv,
      mfName: shell.mfName,
      tailwindPrefix: tailwindPrefixForApp(shell),
      verticalRefs: shell.verticalRefs ?? [],
      owner: resolveOwnerAttribution(shell.ownership),
      deliveryUnit: shellDeliveryUnitBlock(scope, shell),
      degradedState: {
        required: (shell.verticalRefs ?? []).length > 0,
        appId: shell.id,
        status: 'degraded',
      },
      moduleFederation: configEntry.moduleFederation,
    };
  });

  return {
    schemaVersion: WORKSPACE_VALIDATION_CONTRACT_SCHEMA_VERSION,
    kind: WORKSPACE_VALIDATION_CONTRACT_KIND,
    metadata: {
      compactConfig: {
        path: '.modernjs/ultramodern.json',
        schemaVersion: WORKSPACE_METADATA_SCHEMA_VERSION,
      },
      referenceTopology: {
        path: 'topology/reference-topology.json',
        schemaVersion: WORKSPACE_METADATA_SCHEMA_VERSION,
      },
      ownership: {
        path: 'topology/ownership.json',
        schemaVersion: WORKSPACE_METADATA_SCHEMA_VERSION,
      },
      developmentOverlay: {
        path: 'topology/local-overlays/development.json',
        schemaVersion: WORKSPACE_METADATA_SCHEMA_VERSION,
      },
      ...(releaseCohort
        ? {
            releaseCohort: {
              path: '.modernjs/release-cohort.json',
              schemaVersion: releaseCohort.schemaVersion,
            },
          }
        : {}),
    },
    cohort: {
      modernPackages: [...modernPackageCohort],
      ...(releaseCohort ? { releaseCohort } : {}),
      appIds: workspaceApps.map(app => app.id),
      ...(additionalShells.length > 0
        ? {
            additionalShellIds: additionalShells.map(app => app.id),
            additionalShellOwnerIds: additionalShells.map(app => app.id),
            additionalShellDeliveryUnitIds: additionalShells.map(app => app.id),
            additionalShellDegradedStateIds: additionalShells.map(
              app => app.id,
            ),
            additionalShellBuildMarkerIds: additionalShells.map(app => app.id),
          }
        : {}),
      backendAppIds: fullStackVerticals
        .filter(app => app.emitsApi)
        .map(app => app.id),
      verticalIds: remotes.map(app => app.id),
      sharedPackageIds: sharedPackages.map(sharedPackage => sharedPackage.id),
      ownerIds: [
        ...workspaceApps.map(app => app.id),
        ...sharedPackages.map(sharedPackage => sharedPackage.id),
      ],
      packageManifests: [
        {
          id: 'workspace-root',
          packageName: scope,
          path: 'package.json',
          role: 'workspace-root',
        },
        ...workspaceApps.map(app => ({
          id: app.id,
          packageName: packageName(scope, app.packageSuffix),
          path: `${app.directory}/package.json`,
          role: app.kind,
        })),
        ...sharedPackages.map(sharedPackage => ({
          id: sharedPackage.id,
          packageName: packageName(scope, sharedPackage.id),
          path: `${sharedPackage.directory}/package.json`,
          role: 'shared-package',
        })),
      ],
      ...(additionalShells.length > 0
        ? {
            additionalShellManifests: additionalShells.map(app => ({
              id: app.id,
              packageName: packageName(scope, app.packageSuffix),
              path: `${app.directory}/package.json`,
              role: 'shell',
            })),
          }
        : {}),
    },
    topology: {
      compactConfig: compactConfig.topology,
      referenceTopology: createReferenceTopologyExpectation(
        scope,
        remotes,
        resolvedPrimaryShell,
      ),
      ownership: ownershipOverride ?? createOwnership(scope, remotes),
      developmentOverlay:
        developmentOverlayOverride ?? createDevelopmentOverlay(scope, remotes),
    },
    policy: {
      compactConfig: {
        schemaVersion: compactConfig.schemaVersion,
        profile: compactConfig.profile,
        workspace: compactConfig.workspace,
        features: compactConfig.features,
        deploy: compactConfig.deploy,
        moduleFederation: compactConfig.moduleFederation,
        backendFederation: compactConfig.backendFederation,
        agentSkills: compactConfig.agentSkills,
        tooling: compactConfig.tooling,
      },
    },
    legacy: {
      retiredMetadataPaths: [
        '.modernjs/ultramodern-generated-contract.json',
        '.modernjs/ultramodern-package-source.json',
        '.modernjs/ultramodern-workspace-template-manifest.json',
      ],
      forbiddenCompactConfigFields: [
        'generatedContract',
        'packageCohort',
        'workspaceValidationContract',
      ],
      forbiddenPackageSourceFields: [
        'generatedWorkspacePackages',
        'metadata',
        'modernPackages',
      ],
      forbiddenTopologyFields: ['effectServices', 'remotes'],
    },
    validationEvidencePolicy,
    packageScope: scope,
    node: {
      version: NODE_VERSION,
      engineRange: '>=26',
    },
    versions: {
      cloudflareCompatibilityDate: CLOUDFLARE_COMPATIBILITY_DATE,
      effect: EFFECT_VERSION,
      effectVitest: EFFECT_VITEST_VERSION,
      moduleFederation: MODULE_FEDERATION_VERSION,
      node: NODE_VERSION,
      pnpm: PNPM_VERSION,
      tanstackHistory: TANSTACK_HISTORY_VERSION,
    },
    tailwindEnabled: enableTailwind,
    structuralShellPolicy: createStructuralShellPolicy(configuredShells),
    federatedCompositionPolicy: createFederatedCompositionPolicy(
      scope,
      [...configuredShells, ...remotes],
      remotes,
    ),
    ...(additionalShellRecords.length > 0
      ? {
          additionalShells: additionalShellRecords,
        }
      : {}),
    fullStackVerticals,
    shellNamespace: appI18nNamespace(shellApp),
    oldRemotePaths: ['apps/remotes'],
    scripts: createWorkspaceRootScriptPlan(remotes, {
      shells: configuredShells,
    }),
    packageScripts: createWorkspaceRootPackageScripts(remotes, {
      shells: configuredShells,
    }),
    cloudflareSecurity: createCloudflareSecurityContract(),
    publicSurfaceManagedSourceAssetPaths: [
      ...publicSurfaceManagedSourceAssetPaths,
    ],
    shellRouteMetaPaths: createRouteOwnedI18nPaths(shellApp).map(route =>
      createRouteMetaFilePath(shellApp, route.canonicalPath),
    ),
  };
}

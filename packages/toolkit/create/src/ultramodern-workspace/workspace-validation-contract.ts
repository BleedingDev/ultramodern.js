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
  appHasApi,
  appI18nNamespace,
  createShellHost,
  remoteDependencyAlias,
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
import type { WorkspaceApp } from './types';
import {
  CLOUDFLARE_COMPATIBILITY_DATE,
  EFFECT_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
} from './versions';
import {
  createWorkspaceRootPackageScripts,
  createWorkspaceRootScriptPlan,
} from './workspace-script-plan';

const WORKSPACE_VALIDATION_CONTRACT_SCHEMA_VERSION = 1;
const WORKSPACE_METADATA_SCHEMA_VERSION = 1;
const WORKSPACE_VALIDATION_CONTRACT_KIND =
  'modernjs.ultramodern-workspace-validation-contract';

const modernPackageCohort = [
  '@modern-js/create',
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
) {
  const topology = asJsonRecord(createTopology(scope, remotes));
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

type WorkspaceValidationContract = ReturnType<
  typeof createWorkspaceValidationContract
>;

export function createWorkspaceValidationContract(
  scope: string,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
  releaseCohort?: UltramodernReleaseCohort,
) {
  const workspaceApps = [createShellHost(remotes), ...remotes];
  const compactConfig = asJsonRecord(
    createUltramodernConfig(
      scope,
      'workspace-validation-contract',
      {
        strategy: 'workspace',
        modernPackageVersion: 'workspace:*',
      },
      workspaceApps,
      enableTailwind,
    ),
  );
  const fullStackVerticals = remotes.filter(appHasApi).map(remote => ({
    id: remote.id,
    domain: remote.domain,
    stem: remote.api.stem,
    group: verticalApiGroupName(remote),
    path: remote.directory,
    port: remote.port,
    mfName: remote.mfName,
    apiPrefix: remote.api.prefix,
    tailwindPrefix: tailwindPrefixForApp(remote),
    zephyrAlias: remoteDependencyAlias(remote),
    packageName: packageName(scope, remote.packageSuffix),
    backendFederation: createBackendFederationMetadata(scope, remote),
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
      backendAppIds: fullStackVerticals.map(app => app.id),
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
    },
    topology: {
      compactConfig: compactConfig.topology,
      referenceTopology: createReferenceTopologyExpectation(scope, remotes),
      ownership: createOwnership(scope, remotes),
      developmentOverlay: createDevelopmentOverlay(scope, remotes),
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
    packageScope: scope,
    node: {
      version: NODE_VERSION,
      engineRange: '>=26',
    },
    versions: {
      cloudflareCompatibilityDate: CLOUDFLARE_COMPATIBILITY_DATE,
      effect: EFFECT_VERSION,
      moduleFederation: MODULE_FEDERATION_VERSION,
      node: NODE_VERSION,
      pnpm: PNPM_VERSION,
    },
    tailwindEnabled: enableTailwind,
    fullStackVerticals,
    shellNamespace: appI18nNamespace(shellApp),
    oldRemotePaths: ['apps/remotes'],
    scripts: createWorkspaceRootScriptPlan(remotes),
    packageScripts: createWorkspaceRootPackageScripts(remotes),
    cloudflareSecurity: createCloudflareSecurityContract(),
    publicSurfaceManagedSourceAssetPaths: [
      ...publicSurfaceManagedSourceAssetPaths,
    ],
    shellRouteMetaPaths: createRouteOwnedI18nPaths(shellApp).map(route =>
      createRouteMetaFilePath(shellApp, route.canonicalPath),
    ),
  };
}

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
  MODULE_FEDERATION_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
  TYPESCRIPT_COMPILER_API_VERSION,
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

function createGeneratedSurfacePolicy(workspaceApps: WorkspaceApp[]) {
  // Native-navigation / native-MF-loading rules apply to EVERY shell's route
  // tree (G28) — additional shells included, not only the primary.
  const shellRouteDirectories = workspaceApps
    .filter(app => app.kind === 'shell')
    .map(app => ({
      kind: 'directory' as const,
      path: `${app.directory}/src/routes`,
      extensions: ['.ts', '.tsx'],
    }));
  const appConfigPaths = workspaceApps.map(
    app => `${app.directory}/modern.config.ts`,
  );
  const moduleFederationConfigPaths = workspaceApps
    .filter(appEmitsBrowserUi)
    .map(app => `${app.directory}/module-federation.config.ts`);
  const appPackagePaths = workspaceApps.map(
    app => `${app.directory}/package.json`,
  );
  const sourceDirectories = workspaceApps.flatMap(app => [
    `${app.directory}/src`,
    ...(appHasApi(app) ? [`${app.directory}/api`] : []),
  ]);

  return {
    schemaVersion: 1,
    rules: [
      {
        id: 'effect-diagnostics-suppressions',
        paths: [
          ...sourceDirectories.map(path => ({
            kind: 'directory',
            path,
            extensions: ['.ts', '.tsx'],
          })),
          {
            kind: 'directory',
            path: 'scripts',
            extensions: ['.mts', '.ts'],
            excludePaths: ['scripts/validate-ultramodern-workspace.mts'],
          },
          ...appConfigPaths.map(path => ({ kind: 'file', path })),
          ...moduleFederationConfigPaths.map(path => ({ kind: 'file', path })),
        ],
        patterns: [
          {
            id: 'effect-diagnostics-directive',
            expression: '@effect-diagnostics\\b',
            flags: 'u',
            diagnostic:
              'Generated sources must not suppress Effect diagnostics.',
            fixArea: 'remove the @effect-diagnostics suppression directive',
          },
        ],
      },
      {
        id: 'zephyr-gating',
        paths: [
          { kind: 'file', path: 'package.json' },
          ...appPackagePaths.map(path => ({ kind: 'file', path })),
          ...appConfigPaths.map(path => ({ kind: 'file', path })),
          ...moduleFederationConfigPaths.map(path => ({ kind: 'file', path })),
        ],
        patterns: [
          {
            id: 'ultramodern-zephyr-environment-gate',
            expression: '\\bULTRAMODERN_ZEPHYR\\b',
            flags: 'u',
            diagnostic:
              'Generated Zephyr integration must not be gated or disabled through ULTRAMODERN_ZEPHYR.',
            fixArea:
              'use the framework-owned Zephyr integration without a gate',
          },
        ],
      },
      {
        id: 'module-federation-bridge-escapes',
        paths: moduleFederationConfigPaths.map(path => ({
          kind: 'file',
          path,
        })),
        patterns: [
          {
            id: 'bridge-router-disabled',
            expression: '\\benableBridgeRouter\\s*:\\s*false\\b',
            flags: 'u',
            diagnostic:
              'Generated Module Federation must keep bridge routing enabled.',
            fixArea: 'remove enableBridgeRouter: false',
          },
          {
            id: 'dynamic-remote-type-hints-disabled',
            expression: '\\bdisableDynamicRemoteTypeHints\\s*:\\s*true\\b',
            flags: 'u',
            diagnostic:
              'Generated Module Federation must keep dynamic remote type hints enabled.',
            fixArea: 'remove disableDynamicRemoteTypeHints: true',
          },
          {
            id: 'shared-exclude-plugin-tree-shaking',
            expression: '\\btreeShakingSharedExcludePlugins\\b',
            flags: 'u',
            diagnostic:
              'Generated Module Federation must not exclude shared plugins from tree shaking.',
            fixArea: 'remove treeShakingSharedExcludePlugins',
          },
        ],
      },
      {
        id: 'shell-routing-native-navigation',
        paths: shellRouteDirectories,
        patterns: [
          {
            id: 'window-location-navigation',
            expression:
              '\\bwindow\\s*\\.\\s*location(?:\\s*\\.\\s*(?:assign|replace|reload)\\s*\\(|\\s*\\.\\s*href\\s*=|\\s*=)',
            flags: 'u',
            diagnostic:
              'Generated shell routing must use native router navigation instead of window.location.',
            fixArea:
              'replace manual window.location navigation with the router primitive',
          },
          {
            id: 'synthetic-anchor-click-interception',
            structuralMatcher: {
              kind: 'jsx-attribute',
              elementName: 'a',
              attributeName: 'onClick',
            },
            diagnostic:
              'Generated shell routing must not intercept anchor clicks synthetically.',
            fixArea:
              'use the router Link primitive without preventDefault interception',
          },
        ],
      },
      {
        id: 'module-federation-native-loading',
        paths: shellRouteDirectories,
        patterns: [
          {
            id: 'manual-module-federation-loading-wrapper',
            expression: '\\b(?:hydrateRoot|loadRemote|loadShare)\\s*\\(',
            flags: 'u',
            diagnostic:
              'Generated shell routing must use native Module Federation loading primitives.',
            fixArea:
              'remove the manual Module Federation hydration or loading wrapper',
          },
        ],
      },
      {
        id: 'framework-config-api',
        paths: [
          ...appConfigPaths.map(path => ({ kind: 'file', path })),
          ...moduleFederationConfigPaths.map(path => ({ kind: 'file', path })),
        ],
        patterns: [
          {
            id: 'direct-process-env-access',
            expression: '\\bprocess\\s*\\.\\s*env\\b',
            flags: 'u',
            diagnostic:
              'Generated config must use the framework config environment API instead of direct process.env access.',
            fixArea:
              'replace direct process.env access with the framework config API',
          },
          {
            id: 'node-child-process-access',
            expression: '[\'"]node:child_process[\'"]',
            flags: 'u',
            diagnostic:
              'Generated config must not invoke node:child_process directly.',
            fixArea:
              'use the framework config API instead of node:child_process',
          },
        ],
      },
    ],
  };
}

type WorkspaceValidationContract = ReturnType<
  typeof createWorkspaceValidationContract
>;

/**
 * Structural thin-shell gate (G30a). A Shell is a thin composition host: it
 * owns top-level routing, provisions the Platform Baseline, and composes
 * MicroVertical surfaces — it has no business capability. These rules are
 * purely structural (forbidden file classes + forbidden import patterns), not
 * semantic intent detection:
 *
 *  - a shell package must not contain an api/ or server/ surface, or
 *    backend-federation artifacts (forbidden path classes, relative to the
 *    shell package root — the shell's own `src/api/` client is unaffected);
 *  - shell source must not deep-import a vertical's internals — only published
 *    surfaces (package roots / Module Federation) are allowed.
 *
 * The `forbiddenImportPatterns` below are matched by the generated validator
 * against comment-stripped source: it removes line and block comments (in a
 * string-literal-aware pass, so a `//` inside a string such as `'http://x'` is
 * preserved) before running these matchers. A specifier that only appears in a
 * comment therefore never trips the gate, while a real import carrying a magic
 * comment (`import(/* … *\/ '…')`) is still detected once the comment is gone.
 *
 * The generated validator enforces this block; a violating shell fails the
 * generated `validate` script. Emitted for every configured shell (G28).
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
    forbiddenImportPatterns: [
      {
        id: 'vertical-directory-deep-import',
        expression: 'from\\s+[\'"][^\'"]*verticals/[^\'"/]+/',
        flags: 'u',
        diagnostic:
          'A thin Shell must consume only published vertical surfaces (package root or Module Federation), never deep-import a vertical directory.',
      },
      {
        id: 'vertical-directory-side-effect-import',
        expression: String.raw`import\s+['"][^'"]*verticals/[^'"/]+/`,
        flags: 'u',
        diagnostic:
          'A thin Shell must consume only published vertical surfaces; side-effect imports of vertical directories are forbidden.',
      },
      {
        id: 'vertical-directory-dynamic-import',
        expression: String.raw`import\s*\(\s*['"][^'"]*verticals/[^'"/]+/`,
        flags: 'u',
        diagnostic:
          'A thin Shell must consume only published vertical surfaces; dynamic imports of vertical directories are forbidden.',
      },
      {
        id: 'vertical-directory-require',
        expression: String.raw`require\s*\(\s*['"][^'"]*verticals/[^'"/]+/`,
        flags: 'u',
        diagnostic:
          'A thin Shell must consume only published vertical surfaces; require() of vertical directories is forbidden.',
      },
      {
        id: 'workspace-package-source-import',
        expression: 'from\\s+[\'"]@[^\'"/]+/[^\'"/]+/src/',
        flags: 'u',
        diagnostic:
          'A thin Shell must consume only published package surfaces, never deep-import another package’s raw src/ internals (published subpath exports are allowed).',
      },
      {
        id: 'workspace-package-side-effect-import',
        expression: String.raw`import\s+['"]@[^/'"]+/[^/'"]+/src/`,
        flags: 'u',
        diagnostic:
          'A thin Shell must consume only published package surfaces; side-effect imports of raw package src/ are forbidden.',
      },
      {
        id: 'workspace-package-dynamic-import',
        expression: String.raw`import\s*\(\s*['"]@[^/'"]+/[^/'"]+/src/`,
        flags: 'u',
        diagnostic:
          'A thin Shell must consume only published package surfaces; dynamic imports of raw package src/ are forbidden.',
      },
      {
        id: 'workspace-package-require',
        expression: String.raw`require\s*\(\s*['"]@[^/'"]+/[^/'"]+/src/`,
        flags: 'u',
        diagnostic:
          'A thin Shell must consume only published package surfaces; require() of raw package src/ is forbidden.',
      },
    ],
  };
}

function createFederatedCompositionSourcePolicy(
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
    forbiddenSourcePatterns: [
      {
        id: 'hydrated-remote-factory',
        expression: '\\bcreateHydratedRemote\\b',
        flags: 'u',
        diagnostic:
          'Federated hosts must use the framework distributed SSR boundary directly; hydration-time remote factories are forbidden.',
      },
      {
        id: 'hydration-flag',
        expression:
          '\\[\\s*(?:is)?[Hh]ydrated\\s*,\\s*set(?:Is)?Hydrated\\s*\\]\\s*=\\s*useState\\s*\\(\\s*false\\s*\\)',
        flags: 'u',
        diagnostic:
          'Federated hosts must hydrate the server DOM directly; hydrated-state component switching is forbidden.',
      },
      {
        id: 'local-loading-copy',
        expression:
          '(?:loading\\s*:\\s*|fallback\\s*=\\s*\\{\\s*)<\\s*(?:ServerComponent|LocalComponent)\\b',
        flags: 'u',
        diagnostic:
          'Federated hosts must not render a local component copy while loading a remote implementation.',
      },
    ],
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
    generatedSurfacePolicy: createGeneratedSurfacePolicy([
      ...workspaceApps,
      ...additionalShells,
    ]),
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
      typescriptCompilerApi: TYPESCRIPT_COMPILER_API_VERSION,
    },
    tailwindEnabled: enableTailwind,
    structuralShellPolicy: createStructuralShellPolicy(configuredShells),
    federatedCompositionSourcePolicy: createFederatedCompositionSourcePolicy(
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

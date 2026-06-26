import {
  createModernPackagesMetadata,
  modernPackageVersion,
  ULTRAMODERN_WORKSPACE_MODERN_PACKAGES,
  WORKSPACE_PACKAGE_VERSION,
} from '../ultramodern-package-source';
import {
  appHasEffectApi,
  appI18nNamespace,
  createCloudflarePublicUrlEnv,
  createCloudflareWorkerName,
  createModuleFederationRemoteContracts,
  createShellHost,
  effectApiPrefix,
  sharedPackages,
  shellApp,
  verticalEffectApps,
} from './descriptors';
import {
  createEffectDomainOperations,
  createEffectOperationContract,
  createEffectReadinessContract,
  createEffectRequestContextContract,
  effectApiTopologyMetadata,
} from './effect-api';
import {
  fileTemplatesDir,
  hashTemplateTree,
  workspaceTemplateDir,
} from './fs-io';
import { createBuildMarker } from './module-federation';
import {
  createRspackChunkLoadingGlobal,
  createRspackUniqueName,
  packageName,
  tailwindPrefixForApp,
} from './naming';
import {
  createCloudflareDeployContract,
  createCloudflareSecurityContract,
} from './policy';
import { createPublicWebAppArtifacts } from './public-surface';
import {
  createLocalisedUrlsMap,
  createPublicRouteMetadata,
  createRouteOwnedI18nPaths,
} from './routes';
import type {
  JsonValue,
  Ownership,
  ResolvedPackageSource,
  WorkspaceApp,
  WorkspaceEffectApi,
} from './types';
import {
  CLOUDFLARE_COMPATIBILITY_DATE,
  I18NEXT_VERSION,
  MODULE_FEDERATION_AGENT_SKILLS_COMMIT,
  MODULE_FEDERATION_VERSION,
  NODE_VERSION,
  PNPM_VERSION,
  RSTACK_AGENT_SKILLS_COMMIT,
  TANSTACK_ROUTER_VERSION,
  TYPESCRIPT_NATIVE_PREVIEW_VERSION,
  TYPESCRIPT_VERSION,
  WRANGLER_VERSION,
  ZEPHYR_AGENT_VERSION,
  ZEPHYR_RSPACK_PLUGIN_VERSION,
} from './versions';

export const baselineAgentSkills = [
  'rsbuild-best-practices',
  'rspack-best-practices',
  'rspack-tracing',
  'rsdoctor-analysis',
  'rslib-best-practices',
  'rslib-modern-package',
  'rstest-best-practices',
];
export const moduleFederationAgentSkills = ['mf'];
export const privateAgentSkills = [
  'plan-graph',
  'dag',
  'subagent-graph',
  'helm',
  'debugger-mode',
];

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
      commands: ['pnpm i18n:boundaries', 'pnpm contract:check'],
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

export function createPackageSourceMetadata(
  scope: string,
  packageSource: ResolvedPackageSource,
): JsonValue {
  return {
    schemaVersion: 1,
    strategy: packageSource.strategy,
    modernPackages: createModernPackagesMetadata(
      ULTRAMODERN_WORKSPACE_MODERN_PACKAGES,
      packageSource,
    ),
    generatedWorkspacePackages: {
      packages: sharedPackages.map(sharedPackage =>
        packageName(scope, sharedPackage.id),
      ),
      specifier: WORKSPACE_PACKAGE_VERSION,
    },
    validation: {
      validator: 'scripts/validate-ultramodern-workspace.mjs',
      strategyAwareChecks: ['generated-validator'],
    },
  };
}

export function createAppConfigContract(app: WorkspaceApp): JsonValue {
  return {
    preset: 'presetUltramodern',
    plugins: [
      'appTools',
      'tanstackRouterPlugin',
      'i18nPlugin',
      ...(appHasEffectApi(app) ? ['bffPlugin'] : []),
      'moduleFederationPlugin',
      'zephyrRspackPlugin',
    ],
    dev: {
      assetPrefix: '/',
    },
    output: {
      assetPrefix: {
        envFallbackOrder: ['MODERN_ASSET_PREFIX', 'ULTRAMODERN_ASSET_PREFIX'],
        default: '/',
      },
      disableTsChecker: false,
      distPath: {
        html: './',
      },
      polyfill: 'off',
      splitRouteChunks: true,
    },
    performance: {
      readinessDiagnostics: {
        default: 'enabled',
        optOut: {
          env: 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false',
          config: 'scripts/ultramodern-performance-readiness.config.mjs',
        },
        report:
          '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
        failOn: 'framework-invariant',
      },
      rsdoctor: {
        enabledByEnv: 'ULTRAMODERN_RSDOCTOR=true',
        disableClientServer: true,
      },
    },
    rspack: {
      output: {
        uniqueName: createRspackUniqueName(app),
        chunkLoadingGlobal: createRspackChunkLoadingGlobal(app),
      },
    },
    html: {
      outputStructure: 'flat',
    },
    source: {
      mainEntryName: 'index',
      siteUrl: {
        envFallbackOrder: [
          'MODERN_PUBLIC_SITE_URL',
          createCloudflarePublicUrlEnv(app),
          'ULTRAMODERN_CLOUDFLARE_WORKERS_DEV_SUBDOMAIN',
          app.portEnv,
        ],
        defaultLocalhostPort: app.port,
      },
      siteUrlGlobal: 'ULTRAMODERN_SITE_URL',
    },
    ...(appHasEffectApi(app)
      ? {
          bff: {
            runtimeFramework: 'effect',
            prefix: app.effectApi.prefix,
            openapi: '/openapi.json',
          },
        }
      : {}),
  };
}

export function createPerformanceReadinessContract(): JsonValue {
  return {
    schemaVersion: 1,
    default: 'enabled',
    mode: 'diagnostic',
    scope: 'ultramodern-generated-and-framework-owned',
    report: {
      script: 'scripts/ultramodern-performance-readiness.mjs',
      config: 'scripts/ultramodern-performance-readiness.config.mjs',
      defaultPath:
        '.codex/reports/performance-readiness/ultramodern-performance-readiness.json',
      deterministic: true,
    },
    optOut: {
      env: 'ULTRAMODERN_PERFORMANCE_READINESS_DIAGNOSTICS=false',
      config: {
        path: 'scripts/ultramodern-performance-readiness.config.mjs',
        field: 'enabled',
        value: false,
      },
    },
    failurePolicy: {
      defaultFailOn: 'framework-invariant',
      allowedValues: ['framework-invariant', 'never'],
      rejects: [
        'accessibility-certification',
        'product-ui-scoring',
        'marketing-copy-scoring',
        'broad-compliance-engine',
        'rsdoctor-artifact-revival',
      ],
    },
    signals: [
      {
        id: 'bfcache',
        title: 'BFCache diagnostics',
        ownedCheck: 'generated-runtime-static-analysis',
        invariant:
          'Generated UltraModern files must not install beforeunload or unload handlers.',
      },
      {
        id: 'core-web-vitals-rum',
        title: 'Core Web Vitals/RUM readiness',
        ownedCheck: 'preset-telemetry-contract',
        invariant:
          'UltraModern preset telemetry must remain enabled by default without requiring local collectors.',
      },
      {
        id: 'duplicate-prefetch-warmup',
        title: 'Duplicate prefetch/warmup waste',
        ownedCheck: 'topology-and-route-contract',
        invariant:
          'Generated route URLs, remote refs, and manifest URLs must stay deterministic and duplicate-free.',
      },
      {
        id: 'cache-policy-sanity',
        title: 'Cache policy sanity',
        ownedCheck: 'generated-cloudflare-contract',
        invariant:
          'Generated Cloudflare contracts must retain CSS cache-control and public-surface cache expectations.',
      },
      {
        id: 'save-data-behavior',
        title: 'Save-Data behavior',
        ownedCheck: 'framework-router-contract',
        invariant:
          'Automatic framework warmup must remain skippable by browser Save-Data policy.',
      },
      {
        id: 'cloudflare-ssr-cache-hints',
        title: 'Cloudflare SSR response and caching hints',
        ownedCheck: 'generated-cloudflare-proof-contract',
        invariant:
          'Generated Cloudflare SSR proof routes and response/cache hint contracts must be present.',
      },
    ],
  };
}

export function cssLayerName(app: WorkspaceApp): string {
  if (app.kind === 'shell') {
    return 'ultramodern-shell-base';
  }
  return `ultramodern-vertical-${app.domain ?? app.id}`;
}

export function cssRole(app: WorkspaceApp): string {
  if (app.kind === 'shell') {
    return 'shell-base-overlay';
  }
  return 'vertical-css';
}

export function cssClassPrefix(app: WorkspaceApp): string {
  return `${tailwindPrefixForApp(app)}:`;
}

export function createCssDedupeContract(scope: string): JsonValue {
  return {
    strategy: 'shared-token-package-plus-css-content-hash',
    sharedPackage: packageName(scope, 'shared-design-tokens'),
    sharedLayers: ['ultramodern-shared-tokens'],
    runtimeLoad: 'once-per-content-hash',
    duplicateBaseStylesAllowed: false,
  };
}

export function createCssSsrContract(app: WorkspaceApp): JsonValue {
  return {
    cloudflare: true,
    firstPaintRequired: true,
    linkEmission: 'modern-ssr-css-assets',
    verticalCss:
      app.kind === 'shell'
        ? 'host-preloads-shell-and-shared-css'
        : 'federated-manifest-owned-css',
  };
}

export function createAppCssFederationContract(
  scope: string,
  app: WorkspaceApp,
): JsonValue {
  const ownedLayers =
    app.kind === 'shell'
      ? ['ultramodern-shell-base', 'ultramodern-shell-overlay']
      : [cssLayerName(app)];

  return {
    owner: {
      id: app.id,
      package: packageName(scope, app.packageSuffix),
      team: app.ownership.team,
    },
    role: cssRole(app),
    rootSelector: `[data-app-id="${app.id}"]`,
    classPrefix: cssClassPrefix(app),
    layers: {
      shared: ['ultramodern-shared-tokens'],
      owned: ownedLayers,
      imports:
        app.kind === 'shell'
          ? ['ultramodern-shared-tokens']
          : ['ultramodern-shared-tokens'],
    },
    entrypoints: {
      layoutImport: 'src/routes/layout.tsx',
      css: ['src/routes/index.css'],
      ...(app.kind !== 'shell'
        ? { federationEntry: 'src/federation-entry.tsx' }
        : {}),
    },
    assets: {
      shared: [`${packageName(scope, 'shared-design-tokens')}/tokens.css`],
      owned: ['src/routes/index.css'],
      emittedBy: 'modern-rspack-css-extraction',
      contentHash: true,
    },
    dedupe: createCssDedupeContract(scope),
    ssr: createCssSsrContract(app),
  };
}

export function createCssFederationContract(scope: string): JsonValue {
  return {
    schemaVersion: 1,
    sharedDesignTokens: {
      owner: {
        id: 'shared-design-tokens',
        package: packageName(scope, 'shared-design-tokens'),
        team: 'super-app-platform',
      },
      role: 'shared-design-tokens',
      rootSelector: ':root',
      classPrefix: '--um-',
      layers: {
        owned: ['ultramodern-shared-tokens'],
      },
      entrypoints: {
        css: ['packages/shared-design-tokens/src/tokens.css'],
        typescript: ['packages/shared-design-tokens/src/index.ts'],
      },
      assets: {
        exports: ['./tokens.css'],
        css: ['packages/shared-design-tokens/src/tokens.css'],
      },
      dedupe: createCssDedupeContract(scope),
      ssr: {
        cloudflare: true,
        firstPaintRequired: true,
        importedByApps: true,
      },
    },
    ownershipRules: {
      shell: ['base', 'overlay'],
      verticals: ['vertical-css'],
      forbiddenVerticalLayers: [
        'ultramodern-shell-base',
        'ultramodern-shell-overlay',
      ],
    },
  };
}

export function createStylingContract(
  scope: string,
  app: WorkspaceApp,
  enableTailwind: boolean,
): JsonValue {
  return {
    tailwind: enableTailwind,
    ...(enableTailwind
      ? {
          postcssPlugins: ['@tailwindcss/postcss'],
          prefix: tailwindPrefixForApp(app),
          source: '..',
          sourceMode: 'source(none)',
        }
      : {}),
    federation: createAppCssFederationContract(scope, app),
  };
}

export function createAppGeneratedContract(
  scope: string,
  app: WorkspaceApp,
  apps: WorkspaceApp[],
  enableTailwind: boolean,
): JsonValue {
  const appWithResolvedRefs =
    app.kind === 'shell'
      ? {
          ...app,
          verticalRefs: apps
            .filter(candidate => candidate.kind !== 'shell')
            .map(candidate => candidate.id),
        }
      : app;
  const publicWeb = createPublicWebAppArtifacts(app);
  const consumedRemotes = createModuleFederationRemoteContracts(
    appWithResolvedRefs,
    apps,
  );

  return {
    id: app.id,
    package: packageName(scope, app.packageSuffix),
    path: app.directory,
    kind: app.kind,
    config: createAppConfigContract(app),
    styling: createStylingContract(scope, app, enableTailwind),
    deploy: {
      target: 'cloudflare',
      cloudflare: createCloudflareDeployContract(scope, app),
      worker: {
        compatibilityDate: CLOUDFLARE_COMPATIBILITY_DATE,
        name: createCloudflareWorkerName(scope, app),
        security: createCloudflareSecurityContract(),
        ssr: true,
      },
      output: {
        flat: true,
        htmlDistPath: './',
      },
    },
    ssr: {
      mode: 'string',
      moduleFederationAppSSR: true,
    },
    i18n: {
      plugin: '@modern-js/plugin-i18n',
      backend: {
        enabled: true,
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      reactI18next: false,
      languages: ['en', 'cs'],
      fallbackLanguage: 'en',
      namespace: appI18nNamespace(app),
      namespaces: [appI18nNamespace(app), 'translation'],
      publicDir: ['./locales', './assets'],
      localisedUrls: createLocalisedUrlsMap(app),
      resourceOwnership: {
        ownerAppId: app.id,
        source: 'route-owned',
        staticJson: `./locales/{lng}/${appI18nNamespace(app)}.json`,
      },
    },
    routes: {
      source: 'route-owned',
      metadataAuthoring: 'colocated-route-meta',
      generatedManifest: true,
      metadataExport: './src/routes/ultramodern-route-metadata',
      localisedUrls: createLocalisedUrlsMap(app),
      owned: createRouteOwnedI18nPaths(app),
      publicRoutes: createPublicRouteMetadata(app),
      privateByDefault: true,
      publicnessDefault: 'private-app-screen',
      generatedRouteMap: true,
      manualOverrides: [],
      publicHead: publicWeb.publicHead,
      publicSurface: publicWeb.publicSurface,
    },
    moduleFederation: {
      name: app.mfName,
      ...(appWithResolvedRefs.verticalRefs?.length
        ? {
            verticalRefs: appWithResolvedRefs.verticalRefs,
            remotes: consumedRemotes,
          }
        : {}),
      exposes: Object.keys(app.exposes ?? {}),
      dts: {
        displayErrorInTerminal: true,
        compilerInstance: 'tsgo',
      },
      browserSafeExposesOnly: true,
      zephyrRspackPlugin: ZEPHYR_RSPACK_PLUGIN_VERSION,
    },
    marker: {
      appId: app.id,
      packageName: packageName(scope, app.packageSuffix),
      version: '0.1.0',
      build: createBuildMarker(scope, app),
      deployProfile: 'cloudflare-ssr-mf-effect-v1',
      uiSurface: 'ui',
      ...(appHasEffectApi(app) ? { apiSurface: 'effect-bff' } : {}),
    },
    ...(appHasEffectApi(app)
      ? {
          effect: {
            runtime: 'effect',
            import: '@modern-js/plugin-bff/effect-edge',
            prefix: app.effectApi.prefix,
            openapi: '/openapi.json',
            workerEntry: 'worker/__modern_bff_effect.js',
            contract: './shared/effect/api',
            client: './effect/client',
            readiness: createEffectReadinessContract(app),
            requestContext: createEffectRequestContextContract(),
            domainOperations: createEffectDomainOperations(app),
            ...createEffectOperationContract(app),
          },
        }
      : {}),
  };
}

export function createGeneratedContract(
  scope: string,
  apps: WorkspaceApp[] = [createShellHost()],
  enableTailwind = true,
): JsonValue {
  return {
    schemaVersion: 1,
    profile: 'cloudflare-ssr-mf-effect-v1',
    packageManager: {
      source: 'package.json',
      manager: 'pnpm',
      version: PNPM_VERSION,
      toolchain: 'mise',
    },
    node: {
      source: 'package.json engines.node and .mise.toml',
      version: NODE_VERSION,
      engineRange: '>=26',
      toolchain: 'mise',
    },
    versions: {
      typescript: TYPESCRIPT_NATIVE_PREVIEW_VERSION,
      typescriptCompatibility: TYPESCRIPT_VERSION,
      typescriptNativePreview: TYPESCRIPT_NATIVE_PREVIEW_VERSION,
      moduleFederation: MODULE_FEDERATION_VERSION,
      tanstackRouter: TANSTACK_ROUTER_VERSION,
      i18next: I18NEXT_VERSION,
      zephyrRspackPlugin: ZEPHYR_RSPACK_PLUGIN_VERSION,
      zephyrAgent: ZEPHYR_AGENT_VERSION,
      wrangler: WRANGLER_VERSION,
    },
    performanceReadiness: createPerformanceReadinessContract(),
    cssFederation: createCssFederationContract(scope),
    apps: apps.map(app =>
      createAppGeneratedContract(scope, app, apps, enableTailwind),
    ),
  };
}

export function createTemplateManifest(
  modernVersion: string,
  packageSource: ResolvedPackageSource,
): JsonValue {
  return {
    schemaVersion: 1,
    template: {
      id: 'modernjs-ultramodern-superapp-workspace',
      version: modernVersion,
      displayName: 'Modern.js UltraModern SuperApp Workspace',
      description:
        'Growable SuperApp shell, shared packages, and topology skeleton.',
      compatibilityLane: 'ultramodern-mv',
      minimumModernVersion: modernVersion,
    },
    source: {
      type: 'builtin',
      name: 'modernjs-ultramodern-superapp-workspace',
      repositoryPath: 'packages/toolkit/create/template-workspace',
      generator: 'packages/toolkit/create/src/ultramodern-workspace/',
    },
    integrity: {
      checksums: [
        {
          algorithm: 'sha256',
          value: hashTemplateTree(workspaceTemplateDir),
          scope: 'source-tree',
        },
        {
          algorithm: 'sha256',
          value: hashTemplateTree(fileTemplatesDir),
          scope: 'file-templates-tree',
        },
      ],
      provenance: {
        kind: 'repo-local',
        issuer: '@modern-js/create',
        subject: 'packages/toolkit/create/template-workspace',
      },
    },
    materialization: {
      targetRoot: 'generated-project-root',
      allowedPaths: [
        '.agents/**',
        '.codex/**',
        '.github/**',
        '.gitignore',
        '.mise.toml',
        '.modernjs/**',
        'AGENTS.md',
        'README.md',
        'apps/**',
        'packages/**',
        'lefthook.yml',
        'package.json',
        'oxfmt.config.ts',
        'oxlint.config.ts',
        'pnpm-workspace.yaml',
        'scripts/**',
        'topology/**',
        'tsconfig.base.json',
      ],
      deniedPaths: [
        '.git/**',
        '.npmrc',
        '.yarnrc',
        '.env',
        '.env.*',
        'node_modules/**',
        'dist/**',
      ],
      overwritePolicy: 'deny-existing',
    },
    packageSource: {
      strategy: packageSource.strategy,
      config: '.modernjs/ultramodern-package-source.json',
      modernPackageSpecifier: modernPackageVersion(packageSource),
      generatedWorkspacePackageSpecifier: WORKSPACE_PACKAGE_VERSION,
    },
    agentSkills: {
      installDir: '.agents/skills',
      source: {
        repository: 'https://github.com/rstackjs/agent-skills',
        commit: RSTACK_AGENT_SKILLS_COMMIT,
        license: 'MIT',
        licensePath: '.agents/rstackjs-agent-skills-LICENSE',
      },
      baseline: baselineAgentSkills,
      moduleFederationSource: {
        repository: 'https://github.com/module-federation/agent-skills',
        commit: MODULE_FEDERATION_AGENT_SKILLS_COMMIT,
        install: 'clone',
        baseline: moduleFederationAgentSkills,
      },
      privateSource: {
        repository: 'https://github.com/TechsioCZ/skills',
        install: 'clone-if-authorized',
        baseline: privateAgentSkills,
      },
      lockFile: '.agents/skills-lock.json',
    },
    validation: {
      schemaValidation: true,
      sourceValidation: [
        'source-type-supported',
        'checksum-verified',
        'provenance-present',
      ],
      materializationValidation: [
        'path-boundary-policy',
        'path-boundary-denylist',
        'no-path-traversal',
        'no-absolute-paths',
        'overwrite-policy-enforced',
      ],
      postMaterializationValidation: [
        'ultramodern-workspace-contract-check',
        'github-workflow-security-enforced',
        'pnpm-11-policy-enforced',
        'template-manifest-retained',
      ],
      expectedCommands: [
        'mise install',
        'pnpm install',
        'pnpm run i18n:boundaries',
        'pnpm run contract:check',
        'pnpm run performance:readiness',
      ],
    },
  };
}

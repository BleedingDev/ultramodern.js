import {
  modernPackageSpecifier,
  WORKSPACE_PACKAGE_VERSION,
} from '../ultramodern-package-source';
import {
  appHasEffectApi,
  remoteDependencyAlias,
  resolveRemoteRefs,
  shellApp,
  verticalEffectApps,
  zephyrRemoteDependency,
} from './descriptors';
import { readFileTemplate } from './fs-io';
import { packageName, relativeRootFor } from './naming';
import { createPublicSurfaceGenerationCommand } from './public-surface';
import type { JsonValue, ResolvedPackageSource, WorkspaceApp } from './types';
import {
  EFFECT_TSGO_VERSION,
  I18NEXT_VERSION,
  LEFTHOOK_VERSION,
  MODULE_FEDERATION_VERSION,
  OXFMT_VERSION,
  OXLINT_VERSION,
  PNPM_VERSION,
  POSTCSS_VERSION,
  REACT_DOM_VERSION,
  REACT_ROUTER_DOM_VERSION,
  REACT_VERSION,
  TAILWIND_POSTCSS_VERSION,
  TAILWIND_VERSION,
  TANSTACK_ROUTER_VERSION,
  TYPESCRIPT_NATIVE_PREVIEW_VERSION,
  TYPESCRIPT_VERSION,
  ULTRACITE_VERSION,
  WRANGLER_VERSION,
  ZEPHYR_AGENT_VERSION,
  ZEPHYR_RSPACK_PLUGIN_VERSION,
} from './versions';

export const effectTsgoTypecheckCommand =
  "node -e \"const fs = require('node:fs'); const { execFileSync, spawnSync } = require('node:child_process'); const bin = execFileSync('effect-tsgo', ['get-exe-path'], { encoding: 'utf8' }).trim(); if (process.platform !== 'win32') fs.chmodSync(bin, 0o755); const result = spawnSync(bin, ['--noEmit', '-p', 'tsconfig.json'], { stdio: 'inherit' }); process.exit(result.status ?? 1);\"";

export const effectDiagnostics = [
  'anyUnknownInErrorContext',
  'classSelfMismatch',
  'duplicatePackage',
  'effectFnImplicitAny',
  'floatingEffect',
  'genericEffectServices',
  'missingEffectContext',
  'missingEffectError',
  'missingLayerContext',
  'missingReturnYieldStar',
  'missingStarInYieldEffectGen',
  'nonObjectEffectServiceType',
  'outdatedApi',
  'overriddenSchemaConstructor',
  'catchUnfailableEffect',
  'effectFnIife',
  'effectGenUsesAdapter',
  'effectInFailure',
  'effectInVoidSuccess',
  'globalErrorInEffectCatch',
  'globalErrorInEffectFailure',
  'layerMergeAllWithDependencies',
  'lazyPromiseInEffectSync',
  'leakingRequirements',
  'multipleEffectProvide',
  'returnEffectInGen',
  'runEffectInsideEffect',
  'schemaSyncInEffect',
  'scopeInLayerEffect',
  'strictEffectProvide',
  'tryCatchInEffectGen',
  'unknownInEffectCatch',
  'asyncFunction',
  'cryptoRandomUUID',
  'cryptoRandomUUIDInEffect',
  'extendsNativeError',
  'globalConsole',
  'globalConsoleInEffect',
  'globalDate',
  'globalDateInEffect',
  'globalFetch',
  'globalFetchInEffect',
  'globalRandom',
  'globalRandomInEffect',
  'globalTimers',
  'globalTimersInEffect',
  'instanceOfSchema',
  'newPromise',
  'nodeBuiltinImport',
  'preferSchemaOverJson',
  'processEnv',
  'processEnvInEffect',
  'unsafeEffectTypeAssertion',
  'catchAllToMapError',
  'deterministicKeys',
  'effectDoNotation',
  'effectFnOpportunity',
  'effectMapFlatten',
  'effectMapVoid',
  'effectSucceedWithVoid',
  'missedPipeableOpportunity',
  'missingEffectServiceDependency',
  'nestedEffectGenYield',
  'redundantSchemaTagIdentifier',
  'schemaStructWithTag',
  'schemaUnionOfLiterals',
  'serviceNotAsClass',
  'strictBooleanExpressions',
  'unnecessaryArrowBlock',
  'unnecessaryEffectGen',
  'unnecessaryFailYieldableError',
  'unnecessaryPipe',
  'unnecessaryPipeChain',
];

export function appDependencies(
  scope: string,
  packageSource: ResolvedPackageSource,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): Record<string, string> {
  const dependencies: Record<string, string> = {
    '@modern-js/plugin-tanstack': modernPackageSpecifier(
      '@modern-js/plugin-tanstack',
      packageSource,
    ),
    '@modern-js/plugin-i18n': modernPackageSpecifier(
      '@modern-js/plugin-i18n',
      packageSource,
    ),
    '@modern-js/runtime': modernPackageSpecifier(
      '@modern-js/runtime',
      packageSource,
    ),
    '@module-federation/bridge-react': MODULE_FEDERATION_VERSION,
    '@module-federation/modern-js-v3': MODULE_FEDERATION_VERSION,
    '@module-federation/runtime': MODULE_FEDERATION_VERSION,
    '@tanstack/react-router': TANSTACK_ROUTER_VERSION,
    i18next: I18NEXT_VERSION,
    'node-fetch': '^3.3.2',
    [packageName(scope, 'shared-contracts')]: WORKSPACE_PACKAGE_VERSION,
    [packageName(scope, 'shared-design-tokens')]: WORKSPACE_PACKAGE_VERSION,
    react: REACT_VERSION,
    'react-dom': REACT_DOM_VERSION,
    'react-router-dom': REACT_ROUTER_DOM_VERSION,
  };

  if (app.kind === 'shell') {
    dependencies['@modern-js/plugin-bff'] = modernPackageSpecifier(
      '@modern-js/plugin-bff',
      packageSource,
    );
    for (const remote of verticalEffectApps(remotes)) {
      dependencies[packageName(scope, remote.packageSuffix)] =
        WORKSPACE_PACKAGE_VERSION;
    }
  }

  for (const remote of resolveRemoteRefs(app, remotes)) {
    dependencies[packageName(scope, remote.packageSuffix)] =
      WORKSPACE_PACKAGE_VERSION;
  }

  if (appHasEffectApi(app)) {
    dependencies['@modern-js/plugin-bff'] = modernPackageSpecifier(
      '@modern-js/plugin-bff',
      packageSource,
    );
  }

  return dependencies;
}

export function appDevDependencies(
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
): Record<string, string> {
  return {
    '@modern-js/app-tools': modernPackageSpecifier(
      '@modern-js/app-tools',
      packageSource,
    ),
    '@effect/tsgo': EFFECT_TSGO_VERSION,
    ...(enableTailwind
      ? {
          '@tailwindcss/postcss': `^${TAILWIND_POSTCSS_VERSION}`,
          postcss: `^${POSTCSS_VERSION}`,
          tailwindcss: `^${TAILWIND_VERSION}`,
        }
      : {}),
    '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    '@types/node': '^20',
    '@types/react': '^19.2.17',
    '@types/react-dom': '^19.2.3',
    typescript: TYPESCRIPT_VERSION,
    'zephyr-rspack-plugin': ZEPHYR_RSPACK_PLUGIN_VERSION,
    wrangler: WRANGLER_VERSION,
  };
}

export function createRootPackageJson(
  scope: string,
  packageSource: ResolvedPackageSource,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  const shellFilter = `--filter ${packageName(scope, shellApp.packageSuffix)}`;
  const remoteFilters = remotes.map(
    remote => `--filter ${packageName(scope, remote.packageSuffix)}`,
  );
  const remoteBuildPrefix =
    remotes.length > 0
      ? 'ULTRAMODERN_ZEPHYR=false pnpm -r --filter "./verticals/*" run build && '
      : '';
  const remoteCloudflareBuildPrefix =
    remotes.length > 0
      ? 'pnpm -r --filter "./verticals/*" run cloudflare:build && '
      : '';
  const remoteCloudflareDeployPrefix =
    remotes.length > 0
      ? 'pnpm -r --filter "./verticals/*" run cloudflare:deploy && '
      : '';

  return {
    private: true,
    name: scope,
    version: '0.1.0',
    type: 'module',
    packageManager: `pnpm@${PNPM_VERSION}`,
    scripts: {
      dev: `pnpm --parallel ${[shellFilter, ...remoteFilters].join(' ')} dev`,
      'dev:shell': `pnpm --filter ${packageName(
        scope,
        shellApp.packageSuffix,
      )} dev`,
      ...Object.fromEntries(
        remotes.map(remote => [
          `dev:${remote.packageSuffix}`,
          `pnpm --filter ${packageName(scope, remote.packageSuffix)} dev`,
        ]),
      ),
      build: `${remoteBuildPrefix}ULTRAMODERN_ZEPHYR=false pnpm --filter "./apps/shell-super-app" run build && pnpm mf:types`,
      format: "oxfmt . '!repos/**'",
      'format:check': "oxfmt --check . '!repos/**'",
      lint: 'oxlint apps verticals packages',
      'lint:fix': 'oxlint apps verticals packages --fix',
      typecheck: `pnpm -r --filter "@${scope}/*" typecheck`,
      'cloudflare:build': `${remoteCloudflareBuildPrefix}pnpm --filter "./apps/shell-super-app" run cloudflare:build && pnpm mf:types`,
      'cloudflare:deploy': `${remoteCloudflareDeployPrefix}pnpm --filter "./apps/shell-super-app" run cloudflare:deploy`,
      'cloudflare:proof':
        'node ./scripts/proof-cloudflare-version.mjs --out .codex/reports/cloudflare-version-proof/public-url-proof.json',
      'skills:install': 'node ./scripts/bootstrap-agent-skills.mjs',
      'skills:check': 'node ./scripts/bootstrap-agent-skills.mjs --check',
      'agents:refs:install': 'node ./scripts/setup-agent-reference-repos.mjs',
      'agents:refs:check':
        'node ./scripts/setup-agent-reference-repos.mjs --check',
      'mf:types': 'node ./scripts/assert-mf-types.mjs',
      'contract:check': 'node ./scripts/validate-ultramodern-workspace.mjs',
      'i18n:boundaries': 'node ./scripts/check-ultramodern-i18n-boundaries.mjs',
      postinstall:
        "oxfmt . '!repos/**' && node ./scripts/bootstrap-agent-skills.mjs --postinstall && node ./scripts/setup-agent-reference-repos.mjs",
      check:
        'pnpm format:check && pnpm lint && pnpm typecheck && pnpm skills:check && pnpm i18n:boundaries && pnpm contract:check',
    },
    engines: {
      node: '>=20',
      pnpm: `>=${PNPM_VERSION} <11.6.0`,
    },
    workspaces: ['apps/*', 'verticals/*', 'packages/*'],
    modernjs: {
      preset: 'presetUltramodern',
      workspace: 'ultramodern-superapp',
      topology: './topology/reference-topology.json',
      ownership: './topology/ownership.json',
      packageSource: {
        strategy: packageSource.strategy,
        config: './.modernjs/ultramodern-package-source.json',
      },
    },
    devDependencies: {
      '@effect/tsgo': EFFECT_TSGO_VERSION,
      '@modern-js/code-tools': modernPackageSpecifier(
        '@modern-js/code-tools',
        packageSource,
      ),
      '@modern-js/create': modernPackageSpecifier(
        '@modern-js/create',
        packageSource,
      ),
      '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
      lefthook: LEFTHOOK_VERSION,
      oxlint: OXLINT_VERSION,
      oxfmt: OXFMT_VERSION,
      ultracite: ULTRACITE_VERSION,
      wrangler: WRANGLER_VERSION,
      'zephyr-agent': ZEPHYR_AGENT_VERSION,
    },
  };
}

export function createZephyrDependencies(
  scope: string,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  if (!app.verticalRefs?.length) {
    return {};
  }

  return Object.fromEntries(
    resolveRemoteRefs(app, remotes).map(remote => [
      remoteDependencyAlias(remote),
      zephyrRemoteDependency(scope, remote),
    ]),
  );
}

export function createTsConfigBase(): JsonValue {
  return {
    compilerOptions: {
      target: 'ESNext',
      lib: ['ESNext', 'DOM', 'DOM.Iterable'],
      module: 'preserve',
      moduleResolution: 'Bundler',
      moduleDetection: 'force',
      jsx: 'preserve',
      isolatedModules: true,
      verbatimModuleSyntax: true,
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      allowJs: true,
      esModuleInterop: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noPropertyAccessFromIndexSignature: true,
      noImplicitReturns: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      plugins: [
        {
          name: '@effect/language-service',
          diagnostics: true,
          includeSuggestionsInTsc: true,
          ignoreEffectSuggestionsInTscExitCode: false,
          ignoreEffectWarningsInTscExitCode: false,
          ignoreEffectErrorsInTscExitCode: false,
          skipDisabledOptimization: true,
          diagnosticSeverity: Object.fromEntries(
            effectDiagnostics.map(name => [name, 'error']),
          ),
        },
      ],
    },
  };
}

export function createPackageTsConfig(
  packageDir: string,
  includeApi = false,
): JsonValue {
  const include = ['src', 'modern.config.ts', 'module-federation.config.ts'];
  if (includeApi) {
    include.push('api', 'shared');
  }
  return {
    extends: `${relativeRootFor(packageDir)}/tsconfig.base.json`,
    include,
  };
}

export function createAppPackage(
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
): JsonValue {
  const publicSurfaceBuildCommand = createPublicSurfaceGenerationCommand(
    app,
    'dist',
  );
  const publicSurfaceCloudflareBuildCommand =
    createPublicSurfaceGenerationCommand(app, 'dist');
  const publicSurfaceCloudflareOutputCommand =
    createPublicSurfaceGenerationCommand(app, 'cloudflare');
  const packageExports: Record<string, JsonValue> = Object.fromEntries(
    Object.entries(app.exposes ?? {}).map(([expose, source]) => [
      expose,
      source,
    ]),
  );
  const packageJson: Record<string, JsonValue> = {
    private: true,
    name: packageName(scope, app.packageSuffix),
    version: '0.1.0',
    scripts: {
      dev: 'modern dev',
      build: app.exposes
        ? `ULTRAMODERN_ZEPHYR=false modern build && ${publicSurfaceBuildCommand} && node ${relativeRootFor(app.directory)}/scripts/assert-mf-types.mjs`
        : `ULTRAMODERN_ZEPHYR=false modern build && ${publicSurfaceBuildCommand}`,
      'cloudflare:build': `ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern build && ${publicSurfaceCloudflareBuildCommand} && ULTRAMODERN_ZEPHYR=false MODERNJS_DEPLOY=cloudflare modern deploy && ${publicSurfaceCloudflareOutputCommand}`,
      'cloudflare:deploy':
        'ULTRAMODERN_CLOUDFLARE_REQUIRE_PUBLIC_URLS=true pnpm run cloudflare:build && wrangler deploy --config .output/wrangler.json',
      'cloudflare:preview':
        'pnpm run cloudflare:build && wrangler dev --config .output/wrangler.json',
      'cloudflare:proof': `node ${relativeRootFor(
        app.directory,
      )}/scripts/proof-cloudflare-version.mjs --app ${app.id}`,
      serve: 'modern serve',
      typecheck: effectTsgoTypecheckCommand,
    },
    modernjs: {
      preset: 'presetUltramodern',
      role: app.kind === 'shell' ? 'shell' : 'module-federation-remote',
      appId: app.id,
      topology: `${relativeRootFor(app.directory)}/topology/reference-topology.json`,
      ...(appHasEffectApi(app) ? { apiRuntime: 'effect-bff' } : {}),
    },
    'zephyr:dependencies': createZephyrDependencies(scope, app, remotes),
    dependencies: appDependencies(scope, packageSource, app, remotes),
    devDependencies: appDevDependencies(packageSource, enableTailwind),
  };

  if (appHasEffectApi(app)) {
    Object.assign(packageExports, {
      './effect/client': `./src/effect/${app.effectApi.stem}-client.ts`,
      './shared/effect/api': './shared/effect/api.ts',
    });
  } else if (app.kind === 'shell') {
    Object.assign(packageExports, {
      './effect/clients': './src/effect/vertical-clients.ts',
    });
  }

  if (Object.keys(packageExports).length > 0) {
    packageJson.exports = packageExports;
  }

  return packageJson;
}

export function createSharedPackage(
  scope: string,
  id: string,
  description: string,
  packageSource: ResolvedPackageSource,
): JsonValue {
  const packageJson: Record<string, JsonValue> = {
    private: true,
    name: packageName(scope, id),
    version: '0.1.0',
    description,
    type: 'module',
    exports: {
      '.': './src/index.ts',
    },
    scripts: {
      typecheck: effectTsgoTypecheckCommand,
    },
    devDependencies: {
      '@effect/tsgo': EFFECT_TSGO_VERSION,
      '@typescript/native-preview': TYPESCRIPT_NATIVE_PREVIEW_VERSION,
    },
  };

  if (id === 'shared-design-tokens') {
    packageJson.exports = {
      ...(packageJson.exports as Record<string, JsonValue>),
      './tokens.css': './src/tokens.css',
    };
  }

  if (id === 'shared-effect-api') {
    packageJson.dependencies = {
      '@modern-js/plugin-bff': modernPackageSpecifier(
        '@modern-js/plugin-bff',
        packageSource,
      ),
    };
  }

  return packageJson;
}

export function createSharedContractsIndex(): string {
  return readFileTemplate('packages/shared-contracts-index.ts');
}

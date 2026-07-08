import {
  modernPackageSpecifier,
  WORKSPACE_PACKAGE_VERSION,
} from '../ultramodern-package-source';
import type { UltramodernBridgeConfig } from './bridge-config';
import {
  appHasApi,
  remoteDependencyAlias,
  resolveRemoteRefs,
  sharedPackages,
  shellApp,
  verticalApiApps,
  zephyrRemoteDependency,
} from './descriptors';
import { readFileTemplate } from './fs-io';
import { packageName, relativeRootFor } from './naming';
import type { JsonValue, ResolvedPackageSource, WorkspaceApp } from './types';
import {
  EFFECT_TSGO_VERSION,
  I18NEXT_VERSION,
  LEFTHOOK_VERSION,
  MODULE_FEDERATION_VERSION,
  NODE_FETCH_VERSION,
  OXFMT_VERSION,
  OXLINT_VERSION,
  PNPM_VERSION,
  POSTCSS_VERSION,
  REACT_DOM_VERSION,
  REACT_ROUTER_VERSION,
  REACT_VERSION,
  TAILWIND_POSTCSS_VERSION,
  TAILWIND_VERSION,
  TANSTACK_ROUTER_VERSION,
  TYPES_REACT_DOM_VERSION,
  TYPES_REACT_VERSION,
  TYPESCRIPT_NATIVE_PREVIEW_VERSION,
  TYPESCRIPT_VERSION,
  ULTRACITE_VERSION,
  WRANGLER_VERSION,
  ZEPHYR_AGENT_VERSION,
  ZEPHYR_RSPACK_PLUGIN_VERSION,
} from './versions';
import {
  createStrictTsgoTypecheckCommand,
  createWorkspaceAppPackageScripts,
  createWorkspaceRootPackageScripts,
} from './workspace-script-plan';

export function appDependencies(
  scope: string,
  packageSource: ResolvedPackageSource,
  app: WorkspaceApp,
  remotes: WorkspaceApp[] = [],
  bridge?: UltramodernBridgeConfig,
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
    'node-fetch': NODE_FETCH_VERSION,
    [packageName(scope, 'shared-contracts')]: WORKSPACE_PACKAGE_VERSION,
    [packageName(scope, 'shared-design-tokens')]: WORKSPACE_PACKAGE_VERSION,
    react: REACT_VERSION,
    'react-dom': REACT_DOM_VERSION,
    'react-router': REACT_ROUTER_VERSION,
  };

  for (const dependency of bridge?.dependencies ?? []) {
    if (Object.hasOwn(dependencies, dependency)) {
      throw new Error(
        `Bridge mode dependency "${dependency}" conflicts with generated app dependency.`,
      );
    }

    dependencies[dependency] = WORKSPACE_PACKAGE_VERSION;
  }

  if (app.kind === 'shell') {
    dependencies['@modern-js/plugin-bff'] = modernPackageSpecifier(
      '@modern-js/plugin-bff',
      packageSource,
    );
    for (const remote of verticalApiApps(remotes)) {
      dependencies[packageName(scope, remote.packageSuffix)] =
        WORKSPACE_PACKAGE_VERSION;
    }
  }

  for (const remote of resolveRemoteRefs(app, remotes)) {
    dependencies[packageName(scope, remote.packageSuffix)] =
      WORKSPACE_PACKAGE_VERSION;
  }

  if (appHasApi(app)) {
    dependencies['@modern-js/plugin-bff'] = modernPackageSpecifier(
      '@modern-js/plugin-bff',
      packageSource,
    );
  }

  return dependencies;
}

function appDevDependencies(
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
    '@types/react': TYPES_REACT_VERSION,
    '@types/react-dom': TYPES_REACT_DOM_VERSION,
    typescript: TYPESCRIPT_VERSION,
    'zephyr-rspack-plugin': ZEPHYR_RSPACK_PLUGIN_VERSION,
    wrangler: WRANGLER_VERSION,
  };
}

export function createRootPackageJson(
  scope: string,
  packageSource: ResolvedPackageSource,
  remotes: WorkspaceApp[] = [],
  bridge?: UltramodernBridgeConfig,
): JsonValue {
  const shellFilter = `--filter ${packageName(scope, shellApp.packageSuffix)}`;
  const remoteFilters = remotes.map(
    remote => `--filter ${packageName(scope, remote.packageSuffix)}`,
  );
  const bridgeScripts = bridge
    ? {
        ...Object.fromEntries(
          bridge.gates.map(gate => [
            `bridge:${gate.name}`,
            `${gate.cwd ? `cd ${gate.cwd} && ` : ''}${gate.command}`,
          ]),
        ),
        'bridge:check': bridge.gates
          .map(gate => `pnpm run bridge:${gate.name}`)
          .join(' && '),
      }
    : {};
  const bridgeCheck = bridge ? ' && pnpm bridge:check' : '';
  const bridgeTypecheck = bridge
    ? 'pnpm -r --filter "./apps/*" --filter "./verticals/*" --filter "./packages/*" run typecheck'
    : undefined;
  const rootPackageScripts = createWorkspaceRootPackageScripts(remotes, {
    bridgeCheck,
    typecheck: bridgeTypecheck,
  });
  const workspacePackages = [
    'apps/*',
    'verticals/*',
    'packages/*',
    ...(bridge?.workspacePackages.map(entry => entry.pattern) ?? []),
  ];

  return {
    private: true,
    name: scope,
    version: '0.1.0',
    type: 'module',
    packageManager: `pnpm@${PNPM_VERSION}`,
    scripts: {
      dev: `pnpm --parallel ${[shellFilter, ...remoteFilters].join(' ')} dev`,
      'dev:shell': `pnpm --filter ${packageName(scope, shellApp.packageSuffix)} dev`,
      ...Object.fromEntries(
        remotes.map(remote => [
          `dev:${remote.packageSuffix}`,
          `pnpm --filter ${packageName(scope, remote.packageSuffix)} dev`,
        ]),
      ),
      ...rootPackageScripts,
      format: "oxfmt . '!repos/**'",
      'format:check': "oxfmt --check . '!repos/**'",
      lint: 'oxlint apps verticals packages',
      'lint:fix': 'oxlint apps verticals packages --fix',
      'skills:install': 'node ./scripts/bootstrap-agent-skills.mts',
      'skills:check': 'node ./scripts/bootstrap-agent-skills.mts --check',
      'agents:refs:install': 'node ./scripts/setup-agent-reference-repos.mts',
      'agents:refs:check':
        'node ./scripts/setup-agent-reference-repos.mts --check',
      'api:check': 'node ./scripts/check-ultramodern-api-boundaries.mts',
      'i18n:boundaries': 'node ./scripts/check-ultramodern-i18n-boundaries.mts',
      ...bridgeScripts,
      postinstall:
        "oxfmt . '!repos/**' && node ./scripts/bootstrap-agent-skills.mts --postinstall",
    },
    engines: {
      node: '>=26',
      pnpm: '>=11',
    },
    workspaces: workspacePackages,
    modernjs: {
      preset: 'presetUltramodern',
      workspace: 'ultramodern-superapp',
      topology: './topology/reference-topology.json',
      ownership: './topology/ownership.json',
      packageSource: {
        strategy: packageSource.strategy,
        config: './.modernjs/ultramodern.json',
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
      '@modern-js/plugin-bff': modernPackageSpecifier(
        '@modern-js/plugin-bff',
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

function createZephyrDependencies(
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

export {
  createAppMfTypesTsConfig,
  createAppTsConfig,
  createPackageTsConfig,
  createRootTsConfig,
  createSharedPackageTsConfig,
  createTsConfigBase,
} from './tsconfigs';
export function createAppPackage(
  scope: string,
  app: WorkspaceApp,
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
  remotes: WorkspaceApp[] = [],
  bridge?: UltramodernBridgeConfig,
): JsonValue {
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
    scripts: createWorkspaceAppPackageScripts(app),
    modernjs: {
      preset: 'presetUltramodern',
      role: app.kind === 'shell' ? 'shell' : 'module-federation-remote',
      appId: app.id,
      topology: `${relativeRootFor(app.directory)}/topology/reference-topology.json`,
      ...(appHasApi(app) ? { apiRuntime: 'effect' } : {}),
    },
    'zephyr:dependencies': createZephyrDependencies(scope, app, remotes),
    dependencies: appDependencies(scope, packageSource, app, remotes, bridge),
    devDependencies: appDevDependencies(packageSource, enableTailwind),
  };

  if (appHasApi(app)) {
    Object.assign(packageExports, {
      './api': './shared/api.ts',
      './api/client': `./src/api/${app.api.stem}-client.ts`,
    });
  } else if (app.kind === 'shell') {
    Object.assign(packageExports, {
      './api/clients': './src/api/vertical-clients.ts',
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
      typecheck: createStrictTsgoTypecheckCommand(`packages/${id}`),
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

  return packageJson;
}

export function createSharedContractsIndex(): string {
  return readFileTemplate('packages/shared-contracts-index.ts');
}

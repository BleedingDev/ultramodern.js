import {
  modernPackageSpecifier,
  ULTRAMODERN_CREATE_PACKAGE,
  WORKSPACE_PACKAGE_VERSION,
} from '../ultramodern-package-source';
import type { UltramodernBridgeConfig } from './bridge-config';
import {
  appHasApi,
  remoteDependencyAlias,
  resolveApiProtocol,
  resolveRemoteRefs,
  sharedPackages,
  shellApp,
  verticalApiApps,
  zephyrRemoteDependency,
} from './descriptors';
import { readFileTemplate } from './fs-io';
import { packageName, relativeRootFor } from './naming';
import {
  ULTRAMODERN_PACKAGE_PINS,
  ULTRAMODERN_WORKSPACE_POLICY,
} from './policy';
import type { JsonValue, ResolvedPackageSource, WorkspaceApp } from './types';
import {
  createStrictTsgoTypecheckCommand,
  createWorkspaceAppPackageScripts,
  createWorkspaceRootPackageScripts,
  GENERATED_POSTINSTALL_SCRIPT,
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
    ...ULTRAMODERN_PACKAGE_PINS.appDependencies,
    [packageName(scope, 'shared-contracts')]: WORKSPACE_PACKAGE_VERSION,
    [packageName(scope, 'shared-design-tokens')]: WORKSPACE_PACKAGE_VERSION,
  };

  const appRemotes = resolveRemoteRefs(app, remotes);

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
    Object.assign(dependencies, ULTRAMODERN_PACKAGE_PINS.bffEffectDependencies);
    for (const remote of verticalApiApps(remotes)) {
      dependencies[packageName(scope, remote.packageSuffix)] =
        WORKSPACE_PACKAGE_VERSION;
    }
  }

  for (const remote of appRemotes) {
    dependencies[packageName(scope, remote.packageSuffix)] =
      WORKSPACE_PACKAGE_VERSION;
  }

  if (appHasApi(app)) {
    dependencies['@modern-js/plugin-bff'] = modernPackageSpecifier(
      '@modern-js/plugin-bff',
      packageSource,
    );
    Object.assign(dependencies, ULTRAMODERN_PACKAGE_PINS.bffEffectDependencies);
  }

  return dependencies;
}

function appDevDependencies(
  packageSource: ResolvedPackageSource,
  enableTailwind: boolean,
): Record<string, string> {
  const {
    '@rsbuild/plugin-tailwindcss': tailwindPluginVersion,
    tailwindcss: tailwindVersion,
    ...always
  } = ULTRAMODERN_PACKAGE_PINS.appDevDependencies;

  return {
    '@modern-js/app-tools': modernPackageSpecifier(
      '@modern-js/app-tools',
      packageSource,
    ),
    ...always,
    ...(enableTailwind
      ? {
          '@rsbuild/plugin-tailwindcss': tailwindPluginVersion,
          tailwindcss: tailwindVersion,
        }
      : {}),
  };
}

export function createRootPackageJson(
  scope: string,
  packageSource: ResolvedPackageSource,
  remotes: WorkspaceApp[] = [],
  bridge?: UltramodernBridgeConfig,
  additionalShells: WorkspaceApp[] = [],
): JsonValue {
  const shellFilter = `--filter ${packageName(scope, shellApp.packageSuffix)}`;
  const additionalShellFilters = additionalShells.map(
    shell => `--filter ${packageName(scope, shell.packageSuffix)}`,
  );
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
    shells: [shellApp, ...additionalShells],
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
    packageManager: `pnpm@${ULTRAMODERN_WORKSPACE_POLICY.toolchain.packageManager.version}`,
    scripts: {
      dev: `pnpm --parallel ${[shellFilter, ...additionalShellFilters, ...remoteFilters].join(' ')} dev`,
      'dev:shell': `pnpm --filter ${packageName(scope, shellApp.packageSuffix)} dev`,
      ...Object.fromEntries(
        additionalShells.map(shell => [
          `dev:${shell.packageSuffix}`,
          `pnpm --filter ${packageName(scope, shell.packageSuffix)} dev`,
        ]),
      ),
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
      postinstall: GENERATED_POSTINSTALL_SCRIPT,
    },
    engines: {
      node: ULTRAMODERN_WORKSPACE_POLICY.toolchain.node.engineRange,
      pnpm: ULTRAMODERN_WORKSPACE_POLICY.toolchain.packageManager.engineRange,
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
      ...ULTRAMODERN_PACKAGE_PINS.rootDevDependencies,
      '@modern-js/code-tools': modernPackageSpecifier(
        '@modern-js/code-tools',
        packageSource,
      ),
      [ULTRAMODERN_CREATE_PACKAGE]: modernPackageSpecifier(
        ULTRAMODERN_CREATE_PACKAGE,
        packageSource,
      ),
      '@modern-js/plugin-bff': modernPackageSpecifier(
        '@modern-js/plugin-bff',
        packageSource,
      ),
      ...ULTRAMODERN_PACKAGE_PINS.bffEffectDependencies,
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
    if (resolveApiProtocol(app) === 'rpc') {
      Object.assign(packageExports, {
        './api': './shared/rpc.ts',
        './api/rpc-client': `./src/api/${app.api.stem}-rpc-client.ts`,
      });
    } else {
      Object.assign(packageExports, {
        './api': './shared/api.ts',
        './api/client': `./src/api/${app.api.stem}-client.ts`,
      });
    }
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
      '@effect/tsgo':
        ULTRAMODERN_PACKAGE_PINS.appDevDependencies['@effect/tsgo'],
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

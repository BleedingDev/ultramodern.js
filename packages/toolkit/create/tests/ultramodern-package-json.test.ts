import assert from 'node:assert/strict';
import type { UltramodernBridgeConfig } from '../src/ultramodern-workspace/bridge-config';
import {
  createShellHost,
  createVerticalDescriptor,
  shellApp,
} from '../src/ultramodern-workspace/descriptors';
import {
  appDependencies,
  createAppPackage,
  createRootPackageJson,
} from '../src/ultramodern-workspace/package-json';
import type {
  JsonValue,
  ResolvedPackageSource,
  WorkspaceApp,
} from '../src/ultramodern-workspace/types';

const scope = 'tractor-store';
const packageVersion = '3.5.0-ultramodern.9';

const installPackageSource = {
  strategy: 'install',
  modernPackageVersion: packageVersion,
} satisfies ResolvedPackageSource;

const workspacePackageSource = {
  strategy: 'workspace',
  modernPackageVersion: '0.0.0',
} satisfies ResolvedPackageSource;

const bridgeConfig = {
  enabled: true,
  parentRoot: '../tractor-store',
  workspacePackages: [{ pattern: '../tractor-store/packages/*' }],
  dependencies: ['@tractor-store/bridge-kit'],
  lockfilePolicy: 'parent',
  gates: [{ name: 'contracts', command: 'pnpm test' }],
  reactSingletons: [],
} satisfies UltramodernBridgeConfig;

const installAppDependencies = {
  '@modern-js/plugin-tanstack': packageVersion,
  '@modern-js/plugin-i18n': packageVersion,
  '@modern-js/runtime': packageVersion,
  '@module-federation/bridge-react': '2.7.0',
  '@module-federation/modern-js-v3': '2.7.0',
  '@module-federation/runtime': '2.7.0',
  '@tanstack/react-router': '1.170.17',
  i18next: '26.3.6',
  'node-fetch': '^3.3.2',
  '@tractor-store/shared-contracts': 'workspace:*',
  '@tractor-store/shared-design-tokens': 'workspace:*',
  react: '19.2.7',
  'react-dom': '19.2.7',
  'react-router': '7.18.1',
};

function createCatalogVertical() {
  return createVerticalDescriptor('catalog', 4101);
}

function createCheckoutVertical() {
  return createVerticalDescriptor('checkout', 4102);
}

function packageRecord(value: JsonValue) {
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, JsonValue>;
}

test('app dependencies pin generated framework deps and distinguish shell-only from multi-vertical workspaces', () => {
  const catalog = createCatalogVertical();
  const checkout = createCheckoutVertical();
  const shellHost = createShellHost([catalog, checkout]);

  assert.deepEqual(appDependencies(scope, installPackageSource, shellApp), {
    ...installAppDependencies,
    '@modern-js/plugin-bff': packageVersion,
  });
  assert.deepEqual(
    appDependencies(scope, installPackageSource, shellHost, [
      catalog,
      checkout,
    ]),
    {
      ...installAppDependencies,
      '@modern-js/plugin-bff': packageVersion,
      '@tractor-store/catalog': 'workspace:*',
      '@tractor-store/checkout': 'workspace:*',
    },
  );
});

test('bridge dependencies are added after generated app deps and collisions fail closed', () => {
  const catalog = createCatalogVertical();

  assert.deepEqual(
    appDependencies(scope, installPackageSource, catalog, [], bridgeConfig),
    {
      ...installAppDependencies,
      '@tractor-store/bridge-kit': 'workspace:*',
      '@modern-js/plugin-bff': packageVersion,
    },
  );
  assert.throws(
    () =>
      appDependencies(scope, installPackageSource, catalog, [], {
        ...bridgeConfig,
        dependencies: ['react'],
      }),
    {
      message:
        'Bridge mode dependency "react" conflicts with generated app dependency.',
    },
  );
});

test('workspace package source uses workspace versions for generated framework deps', () => {
  const packageJson = packageRecord(
    createAppPackage(
      scope,
      createCatalogVertical(),
      workspacePackageSource,
      false,
    ),
  );

  assert.deepEqual(packageJson.dependencies, {
    '@modern-js/plugin-tanstack': 'workspace:*',
    '@modern-js/plugin-i18n': 'workspace:*',
    '@modern-js/runtime': 'workspace:*',
    '@module-federation/bridge-react': '2.7.0',
    '@module-federation/modern-js-v3': '2.7.0',
    '@module-federation/runtime': '2.7.0',
    '@tanstack/react-router': '1.170.17',
    i18next: '26.3.6',
    'node-fetch': '^3.3.2',
    '@tractor-store/shared-contracts': 'workspace:*',
    '@tractor-store/shared-design-tokens': 'workspace:*',
    react: '19.2.7',
    'react-dom': '19.2.7',
    'react-router': '7.18.1',
    '@modern-js/plugin-bff': 'workspace:*',
  });
});

test('root package json pins workspace package versions and bridge workspace globs', () => {
  const catalog = createCatalogVertical();
  const checkout = createCheckoutVertical();
  const rootPackageJson = packageRecord(
    createRootPackageJson(
      scope,
      installPackageSource,
      [catalog, checkout],
      bridgeConfig,
    ),
  );

  assert.deepEqual(rootPackageJson.workspaces, [
    'apps/*',
    'verticals/*',
    'packages/*',
    '../tractor-store/packages/*',
  ]);
  assert.deepEqual(rootPackageJson.devDependencies, {
    '@effect/tsgo': '0.18.1',
    '@modern-js/code-tools': packageVersion,
    '@modern-js/create': packageVersion,
    '@modern-js/plugin-bff': packageVersion,
    '@typescript/typescript6': '6.0.2',
    lefthook: '^2.1.10',
    oxlint: '1.73.0',
    oxfmt: '0.58.0',
    ultracite: '7.9.3',
    wrangler: '4.110.0',
    'zephyr-agent': '1.1.1',
  });
});

test('app package generation throws for unknown remote refs', () => {
  const missingRemoteShell = {
    ...shellApp,
    verticalRefs: ['missing'],
  } satisfies WorkspaceApp;

  assert.throws(
    () =>
      createAppPackage(scope, missingRemoteShell, installPackageSource, false, [
        createCatalogVertical(),
      ]),
    {
      message:
        'Unknown remote vertical reference missing for shell-super-app. Available remotes: catalog.',
    },
  );
});

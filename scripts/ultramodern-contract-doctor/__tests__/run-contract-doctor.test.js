const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const {
  EXPECTED_TANSTACK_ROUTER,
  runUltramodernContractDoctor,
} = require('../run-contract-doctor');

function writeJson(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ultramodern-doctor-'));
  writeJson(root, 'package.json', {
    modernjs: { preset: 'presetUltramodern' },
  });
  writeJson(root, '.modernjs/ultramodern-workspace-template-manifest.json', {
    template: { id: 'modernjs-ultramodern-superapp-workspace' },
  });
  writeJson(root, 'topology/reference-topology.json', {
    preset: 'presetUltramodern',
    shell: { id: 'shell-super-app' },
    remotes: [
      {
        id: 'remote-commerce',
        kind: 'vertical',
        moduleFederation: {
          manifestUrl: 'http://localhost:3021/mf-manifest.json',
        },
        api: {
          effect: {
            runtime: 'effect',
            bff: { prefix: '/commerce-api' },
            contract: {
              export: './shared/effect/api',
              path: 'apps/remotes/remote-commerce/shared/effect/api.ts',
            },
            client: {
              export: './effect/client',
              path: 'apps/remotes/remote-commerce/src/effect/recommendations-client.ts',
            },
            serverEntry: 'apps/remotes/remote-commerce/api/effect/index.ts',
          },
        },
      },
      {
        id: 'remote-identity',
        kind: 'vertical',
        moduleFederation: {
          manifestUrl: 'http://localhost:3022/mf-manifest.json',
        },
        api: {
          effect: {
            runtime: 'effect',
            bff: { prefix: '/identity-api' },
            contract: {
              export: './shared/effect/api',
              path: 'apps/remotes/remote-identity/shared/effect/api.ts',
            },
            client: {
              export: './effect/client',
              path: 'apps/remotes/remote-identity/src/effect/identity-client.ts',
            },
            serverEntry: 'apps/remotes/remote-identity/api/effect/index.ts',
          },
        },
      },
      { id: 'remote-design-system', kind: 'horizontal-design-system' },
    ],
    effectServices: [],
  });
  writeJson(root, 'topology/ownership.json', {
    owners: [
      { id: 'shell-super-app', path: 'apps/shell-super-app' },
      { id: 'remote-commerce', path: 'apps/remotes/remote-commerce' },
      { id: 'remote-identity', path: 'apps/remotes/remote-identity' },
      {
        id: 'remote-design-system',
        path: 'apps/remotes/remote-design-system',
      },
    ],
  });
  for (const appPath of [
    'apps/shell-super-app',
    'apps/remotes/remote-design-system',
  ]) {
    writeJson(root, `${appPath}/package.json`, {
      dependencies: {
        '@modern-js/plugin-i18n': 'workspace:*',
        '@modern-js/plugin-tanstack': 'workspace:*',
        '@modern-js/runtime': 'workspace:*',
        '@tanstack/react-router': EXPECTED_TANSTACK_ROUTER,
      },
      devDependencies: {
        '@modern-js/app-tools': 'workspace:*',
        'zephyr-rspack-plugin': '1.1.1',
      },
    });
    writeText(root, `${appPath}/src/routes/page.tsx`, 'export default null;\n');
  }
  for (const vertical of [
    {
      id: 'remote-commerce',
      stem: 'recommendations',
      group: 'recommendations',
      path: 'apps/remotes/remote-commerce',
      prefix: '/commerce-api',
    },
    {
      id: 'remote-identity',
      stem: 'identity',
      group: 'identity',
      path: 'apps/remotes/remote-identity',
      prefix: '/identity-api',
    },
  ]) {
    writeJson(root, `${vertical.path}/package.json`, {
      dependencies: {
        '@modern-js/plugin-bff': 'workspace:*',
        '@modern-js/plugin-i18n': 'workspace:*',
        '@modern-js/plugin-tanstack': 'workspace:*',
        '@modern-js/runtime': 'workspace:*',
        '@tanstack/react-router': EXPECTED_TANSTACK_ROUTER,
      },
      devDependencies: {
        '@modern-js/app-tools': 'workspace:*',
        'zephyr-rspack-plugin': '1.1.1',
      },
      exports: {
        './effect/client': `./src/effect/${vertical.stem}-client.ts`,
        './shared/effect/api': './shared/effect/api.ts',
      },
    });
    writeText(
      root,
      `${vertical.path}/src/routes/page.tsx`,
      'export default null;\n',
    );
    writeText(
      root,
      `${vertical.path}/modern.config.ts`,
      `moduleFederationPlugin(); bffPlugin(); runtimeFramework: 'effect'; prefix: '${vertical.prefix}'; moduleFederationAppSSR: true; outputStructure: 'flat';\n`,
    );
    writeText(
      root,
      `${vertical.path}/module-federation.config.ts`,
      "displayErrorInTerminal: true; compilerInstance: '--package typescript -- tsc'; './Route'; './Widget';\n",
    );
    writeText(
      root,
      `${vertical.path}/shared/effect/api.ts`,
      `HttpApi.make('${vertical.group}'); export const ${vertical.group}EffectApi = {}; export const ${vertical.group}ApiContract = {}; export const ${vertical.group}OperationContexts = {};\n`,
    );
    writeText(
      root,
      `${vertical.path}/src/effect/${vertical.stem}-client.ts`,
      `makeEffectHttpApiClient(${vertical.group}EffectApi); export const client = ${vertical.group}EffectApi;\n`,
    );
    writeText(
      root,
      `${vertical.path}/api/effect/index.ts`,
      `defineEffectBff({ api: ${vertical.group}EffectApi }); Effect.withSpan('span');\n`,
    );
  }
  writeJson(root, 'packages/shared-contracts/package.json', {
    name: '@test/shared-contracts',
  });
  writeJson(root, 'packages/shared-effect-api/package.json', {
    name: '@test/shared-effect-api',
  });
  writeText(
    root,
    'packages/shared-effect-api/src/index.ts',
    'export const api = {};\n',
  );
  writeJson(root, '.modernjs/ultramodern-generated-contract.json', {
    apps: [
      {
        id: 'remote-commerce',
        config: {
          preset: 'presetUltramodern',
          plugins: [
            'appTools',
            'tanstackRouterPlugin',
            'i18nPlugin',
            'bffPlugin',
            'moduleFederationPlugin',
            'zephyrRspackPlugin',
          ],
          bff: {
            runtimeFramework: 'effect',
            prefix: '/commerce-api',
          },
          html: { outputStructure: 'flat' },
        },
        ssr: { moduleFederationAppSSR: true },
        moduleFederation: {
          exposes: ['./Widget', './Route'],
          dts: {
            displayErrorInTerminal: true,
            compilerInstance: '--package typescript -- tsc',
          },
        },
        effect: {
          runtime: 'effect',
          contract: './shared/effect/api',
          client: './effect/client',
          group: 'recommendations',
          workerEntry: 'worker/__modern_bff_effect.js',
          operations: {
            list: { source: 'generated-client' },
          },
        },
      },
      {
        id: 'remote-identity',
        config: {
          preset: 'presetUltramodern',
          plugins: [
            'appTools',
            'tanstackRouterPlugin',
            'i18nPlugin',
            'bffPlugin',
            'moduleFederationPlugin',
            'zephyrRspackPlugin',
          ],
          bff: {
            runtimeFramework: 'effect',
            prefix: '/identity-api',
          },
          html: { outputStructure: 'flat' },
        },
        ssr: { moduleFederationAppSSR: true },
        moduleFederation: {
          exposes: ['./Widget', './Route'],
          dts: {
            displayErrorInTerminal: true,
            compilerInstance: '--package typescript -- tsc',
          },
        },
        effect: {
          runtime: 'effect',
          contract: './shared/effect/api',
          client: './effect/client',
          group: 'identity',
          workerEntry: 'worker/__modern_bff_effect.js',
          operations: {
            list: { source: 'generated-client' },
          },
        },
      },
    ],
  });
  return root;
}

test('passes a generated UltraModern workspace shape', () => {
  const root = createWorkspace();
  try {
    const result = runUltramodernContractDoctor({ workspace: root });
    assert.equal(result.status, 'pass');
    assert.equal(result.summary.failed, 0);
    assert.ok(result.checks.some(check => check.id === 'topology-remotes'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reports stale TanStack versions and deprecated generated imports', () => {
  const root = createWorkspace();
  try {
    writeJson(root, 'apps/remotes/remote-commerce/package.json', {
      dependencies: {
        '@modern-js/plugin-tanstack': 'workspace:*',
        '@modern-js/runtime': 'workspace:*',
        '@tanstack/react-router': '1.168.26',
      },
    });
    writeText(
      root,
      'apps/remotes/remote-commerce/src/routes/page.tsx',
      "import '@modern-js/runtime/tanstack-router';\n",
    );
    const result = runUltramodernContractDoctor({ workspace: root });
    assert.equal(result.status, 'fail');
    assert.ok(
      result.checks.some(
        check => check.id === 'tanstack-version-remote-commerce',
      ),
    );
    assert.ok(
      result.checks.some(
        check =>
          check.id === 'deprecated-marker-modern-js-runtime-tanstack-router' &&
          check.status === 'fail',
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects split default vertical services and unsafe remote exposes', () => {
  const root = createWorkspace();
  try {
    writeJson(root, 'topology/reference-topology.json', {
      preset: 'presetUltramodern',
      shell: { id: 'shell-super-app' },
      remotes: [
        {
          id: 'remote-commerce',
          kind: 'vertical',
          moduleFederation: {
            manifestUrl: 'http://localhost:3021/mf-manifest.json',
          },
        },
        {
          id: 'remote-identity',
          kind: 'vertical',
          moduleFederation: {
            manifestUrl: 'http://localhost:3022/mf-manifest.json',
          },
          api: {
            effect: {
              runtime: 'effect',
              bff: { prefix: '/identity-api' },
              contract: { export: './shared/effect/api' },
              client: { export: './effect/client' },
            },
          },
        },
        { id: 'remote-design-system', kind: 'horizontal-design-system' },
      ],
      effectServices: [{ id: 'service-recommendations-effect' }],
    });
    writeText(
      root,
      'apps/remotes/remote-commerce/module-federation.config.ts',
      "displayErrorInTerminal: true; compilerInstance: '--package typescript -- tsc'; './Route'; './Widget'; './api';\n",
    );
    const generatedContract = JSON.parse(
      fs.readFileSync(
        path.join(root, '.modernjs/ultramodern-generated-contract.json'),
        'utf8',
      ),
    );
    generatedContract.apps.find(
      app => app.id === 'remote-commerce',
    ).moduleFederation.exposes = ['./Widget', './Route', './api'];
    writeJson(
      root,
      '.modernjs/ultramodern-generated-contract.json',
      generatedContract,
    );
    writeJson(root, 'services/service-recommendations-effect/package.json', {});

    const result = runUltramodernContractDoctor({ workspace: root });
    assert.equal(result.status, 'fail');
    assert.ok(
      result.checks.some(
        check =>
          check.id === 'topology-no-default-effect-service-split' &&
          check.status === 'fail',
      ),
    );
    assert.ok(
      result.checks.some(
        check =>
          check.id === 'topology-full-stack-remote-commerce' &&
          check.status === 'fail',
      ),
    );
    assert.ok(
      result.checks.some(
        check =>
          check.id === 'full-stack-mf-browser-safe-remote-commerce' &&
          check.status === 'fail',
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts an install-backed UltraModern package source strategy', () => {
  const root = createWorkspace();
  try {
    writeJson(root, '.modernjs/ultramodern-package-source.json', {
      schemaVersion: 1,
      strategy: 'install',
      modernPackages: {
        packages: [
          '@modern-js/app-tools',
          '@modern-js/plugin-bff',
          '@modern-js/plugin-i18n',
          '@modern-js/plugin-tanstack',
          '@modern-js/runtime',
        ],
        specifier: '3.2.0',
      },
      generatedWorkspacePackages: {
        packages: ['@test/shared-contracts'],
        specifier: 'workspace:*',
      },
    });
    writeJson(root, 'package.json', {
      modernjs: {
        preset: 'presetUltramodern',
        packageSource: {
          strategy: 'install',
          config: './.modernjs/ultramodern-package-source.json',
        },
      },
    });
    for (const appPath of [
      'apps/shell-super-app',
      'apps/remotes/remote-commerce',
      'apps/remotes/remote-identity',
      'apps/remotes/remote-design-system',
    ]) {
      const isFullStackVertical =
        appPath === 'apps/remotes/remote-commerce' ||
        appPath === 'apps/remotes/remote-identity';
      writeJson(root, `${appPath}/package.json`, {
        dependencies: {
          ...(isFullStackVertical ? { '@modern-js/plugin-bff': '3.2.0' } : {}),
          '@modern-js/plugin-i18n': '3.2.0',
          '@modern-js/plugin-tanstack': '3.2.0',
          '@modern-js/runtime': '3.2.0',
          '@tanstack/react-router': EXPECTED_TANSTACK_ROUTER,
        },
        devDependencies: {
          '@modern-js/app-tools': '3.2.0',
          ...(isFullStackVertical ? { 'zephyr-rspack-plugin': '1.1.1' } : {}),
        },
      });
    }

    const result = runUltramodernContractDoctor({ workspace: root });
    assert.equal(result.status, 'pass');
    assert.ok(
      result.checks.some(check => check.id === 'package-source-strategy'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects root package source strategy drift', () => {
  const root = createWorkspace();
  try {
    writeJson(root, '.modernjs/ultramodern-package-source.json', {
      schemaVersion: 1,
      strategy: 'install',
      modernPackages: {
        packages: [
          '@modern-js/app-tools',
          '@modern-js/plugin-bff',
          '@modern-js/plugin-tanstack',
          '@modern-js/runtime',
        ],
        specifier: '3.2.0',
      },
      generatedWorkspacePackages: {
        packages: ['@test/shared-contracts'],
        specifier: 'workspace:*',
      },
    });
    writeJson(root, 'package.json', {
      modernjs: {
        preset: 'presetUltramodern',
        packageSource: {
          strategy: 'workspace',
          config: './.modernjs/ultramodern-package-source.json',
        },
      },
    });

    const result = runUltramodernContractDoctor({ workspace: root });
    assert.equal(result.status, 'fail');
    assert.ok(
      result.checks.some(
        check =>
          check.id === 'package-source-root-strategy' &&
          check.status === 'fail',
      ),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

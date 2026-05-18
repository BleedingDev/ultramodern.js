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
      { id: 'remote-commerce', kind: 'vertical' },
      { id: 'remote-identity', kind: 'vertical' },
      { id: 'remote-design-system', kind: 'horizontal-design-system' },
    ],
    effectServices: [{ id: 'service-recommendations-effect' }],
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
      {
        id: 'service-recommendations-effect',
        path: 'services/service-recommendations-effect',
      },
    ],
  });
  for (const appPath of [
    'apps/shell-super-app',
    'apps/remotes/remote-commerce',
    'apps/remotes/remote-identity',
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
      },
    });
    writeText(root, `${appPath}/src/routes/page.tsx`, 'export default null;\n');
  }
  writeText(
    root,
    'services/service-recommendations-effect/modern.config.ts',
    "runtimeFramework: 'effect'\n",
  );
  writeJson(root, 'services/service-recommendations-effect/package.json', {
    devDependencies: {
      '@modern-js/plugin-bff': 'workspace:*',
    },
  });
  writeText(
    root,
    'services/service-recommendations-effect/shared/effect/api.ts',
    'export const api = {};\n',
  );
  writeText(
    root,
    'services/service-recommendations-effect/api/effect/index.ts',
    'defineEffectBff({});\n',
  );
  writeJson(root, 'packages/shared-contracts/package.json', {
    name: '@test/shared-contracts',
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
      writeJson(root, `${appPath}/package.json`, {
        dependencies: {
          '@modern-js/plugin-i18n': '3.2.0',
          '@modern-js/plugin-tanstack': '3.2.0',
          '@modern-js/runtime': '3.2.0',
          '@tanstack/react-router': EXPECTED_TANSTACK_ROUTER,
        },
        devDependencies: {
          '@modern-js/app-tools': '3.2.0',
        },
      });
    }
    writeJson(root, 'services/service-recommendations-effect/package.json', {
      devDependencies: {
        '@modern-js/plugin-bff': '3.2.0',
      },
    });

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

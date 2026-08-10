import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  addUltramodernVertical,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';
import {
  hasUltramodernBridgeCliOptions,
  normalizeUltramodernBridgeConfig,
  parseUltramodernBridgeCliOptions,
} from '../src/ultramodern-workspace/bridge-config';

const readJson = (root: string, relativePath: string) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf-8'));

test('bridge config is disabled by default and normalizes explicit API input', () => {
  assert.equal(normalizeUltramodernBridgeConfig(undefined), undefined);
  assert.equal(normalizeUltramodernBridgeConfig({ enabled: false }), undefined);

  const bridge = normalizeUltramodernBridgeConfig({
    parentRoot: '..',
    workspacePackages: [
      {
        pattern: '../packages/domain-core',
        packageNames: [
          '@acme/domain-core',
          '@acme/domain-core',
          '@acme/domain-events',
        ],
        testAliases: [
          {
            alias: '@acme/domain-core',
            target: '../packages/domain-core/src/index.ts',
          },
          {
            alias: '@acme/domain-core/testing',
            target: '../packages/domain-core/src/testing.ts',
          },
        ],
      },
    ],
    dependencies: [
      '@acme/domain-core',
      '@acme/domain-core',
      '@acme/domain-events',
    ],
    gates: [
      {
        name: 'parent-rstest',
        command: 'pnpm exec rstest packages/domain-core/tests',
        cwd: '..',
      },
    ],
    reactSingletons: ['react', 'react-dom', 'react', 'scheduler'],
  });

  assert.deepEqual(bridge, {
    enabled: true,
    parentRoot: '..',
    workspacePackages: [
      {
        pattern: '../packages/domain-core',
        packageNames: ['@acme/domain-core', '@acme/domain-events'],
        testAliases: [
          {
            alias: '@acme/domain-core',
            target: '../packages/domain-core/src/index.ts',
          },
          {
            alias: '@acme/domain-core/testing',
            target: '../packages/domain-core/src/testing.ts',
          },
        ],
      },
    ],
    dependencies: ['@acme/domain-core', '@acme/domain-events'],
    lockfilePolicy: 'nested',
    gates: [
      {
        name: 'parent-rstest',
        command: 'pnpm exec rstest packages/domain-core/tests',
        cwd: '..',
      },
    ],
    reactSingletons: ['react', 'react-dom', 'scheduler'],
  });
});

test('bridge CLI parser requires explicit parent package consumption data', () => {
  assert.equal(hasUltramodernBridgeCliOptions([]), false);
  assert.equal(parseUltramodernBridgeCliOptions([]), undefined);

  const bridge = parseUltramodernBridgeCliOptions([
    '--bridge',
    '--bridge-parent-root',
    '..',
    '--bridge-workspace-package',
    '../packages/domain-core',
    '--bridge-workspace-package-name',
    '../packages/domain-core=@acme/domain-core,@acme/domain-events',
    '--bridge-test-alias',
    '../packages/domain-core:@acme/domain-core=../packages/domain-core/src/index.ts',
    '--bridge-test-alias',
    '../packages/domain-core:@acme/domain-core/testing=../packages/domain-core/src/testing.ts',
    '--bridge-dependency',
    '@acme/domain-core',
    '--bridge-dependency=@acme/domain-events',
    '--bridge-lockfile-policy=parent',
    '--bridge-gate',
    'parent-rstest=pnpm exec rstest packages/domain-core/tests',
    '--bridge-gate-cwd=parent-rstest=..',
    '--bridge-react-singleton',
    'react,react-dom,scheduler',
  ]);

  assert.deepEqual(bridge, {
    enabled: true,
    parentRoot: '..',
    workspacePackages: [
      {
        pattern: '../packages/domain-core',
        packageNames: ['@acme/domain-core', '@acme/domain-events'],
        testAliases: [
          {
            alias: '@acme/domain-core',
            target: '../packages/domain-core/src/index.ts',
          },
          {
            alias: '@acme/domain-core/testing',
            target: '../packages/domain-core/src/testing.ts',
          },
        ],
      },
    ],
    dependencies: ['@acme/domain-core', '@acme/domain-events'],
    lockfilePolicy: 'parent',
    gates: [
      {
        name: 'parent-rstest',
        command: 'pnpm exec rstest packages/domain-core/tests',
        cwd: '..',
      },
    ],
    reactSingletons: ['react', 'react-dom', 'scheduler'],
  });
});

test('bridge CLI parser rejects partial or invalid bridge mode', () => {
  assert.throws(
    () => parseUltramodernBridgeCliOptions(['--bridge']),
    /--bridge-parent-root must be a non-empty string/,
  );

  assert.throws(
    () =>
      parseUltramodernBridgeCliOptions([
        '--bridge-parent-root=..',
        '--bridge-dependency=@acme/domain-core',
        '--bridge-gate=typecheck=pnpm check',
      ]),
    /bridge\.workspacePackages/,
  );

  assert.throws(
    () =>
      normalizeUltramodernBridgeConfig({
        parentRoot: '..',
        workspacePackages: [
          {
            pattern: '../packages/domain-core',
            testAliases: [
              {
                alias: '@acme/domain-core',
                target: '../packages/domain-core/src/index.ts',
              },
            ],
          },
        ],
        dependencies: ['@acme/domain-core'],
        gates: [
          {
            name: 'parent-rstest',
            command: 'pnpm exec rstest packages/domain-core/tests',
          },
        ],
      }),
    /bridge\.workspacePackages\[0\]\.packageNames/,
  );

  assert.throws(
    () =>
      normalizeUltramodernBridgeConfig({
        parentRoot: '..',
        workspacePackages: [
          {
            pattern: '../packages/domain-core',
            packageNames: ['@acme/domain-core'],
          },
        ],
        dependencies: ['@acme/domain-core', '@acme/payments-core'],
        gates: [
          {
            name: 'parent-rstest',
            command: 'pnpm exec rstest packages/domain-core/tests',
          },
        ],
      }),
    /dependencies must be declared/,
  );

  assert.throws(
    () =>
      normalizeUltramodernBridgeConfig({
        parentRoot: '..',
        workspacePackages: [
          {
            pattern: '../packages/domain-core',
            packageNames: ['@acme/domain-core'],
            testAliases: [
              {
                alias: '@acme/payments-core',
                target: '../packages/payments-core/src/index.ts',
              },
            ],
          },
        ],
        dependencies: ['@acme/domain-core'],
        gates: [
          {
            name: 'parent-rstest',
            command: 'pnpm exec rstest packages/domain-core/tests',
          },
        ],
      }),
    /testAliases entry "@acme\/payments-core" must match/,
  );

  assert.throws(
    () =>
      normalizeUltramodernBridgeConfig({
        parentRoot: '..',
        workspacePackages: [
          {
            pattern: '../packages/domain-core',
            packageNames: ['@acme/domain-core'],
            testAliases: [
              {
                alias: '@acme/domain-core',
                target: '../packages/domain-core/dist/index.js',
              },
            ],
          },
        ],
        dependencies: ['@acme/domain-core'],
        gates: [
          {
            name: 'parent-rstest',
            command: 'pnpm exec rstest packages/domain-core/tests',
          },
        ],
      }),
    /source files, not dist output/,
  );

  assert.throws(
    () =>
      normalizeUltramodernBridgeConfig({
        parentRoot: '..',
        workspacePackages: [
          {
            pattern: '../packages/domain-core',
            packageNames: ['@acme/domain-core'],
          },
        ],
        dependencies: ['@acme/domain-core'],
        gates: [
          {
            name: 'parent-rstest',
            command: 'pnpm exec rstest packages/domain-core/tests',
          },
        ],
        reactSingletons: ['react'],
      }),
    /React singleton\/dedupe declarations must include react and react-dom/,
  );

  assert.throws(
    () =>
      parseUltramodernBridgeCliOptions([
        '--bridge-parent-root=..',
        '--bridge-workspace-package=../packages/*',
        '--bridge-dependency=@acme/domain-core',
        '--bridge-lockfile-policy=shared',
        '--bridge-gate=typecheck=pnpm check',
      ]),
    /--bridge-lockfile-policy must be "nested" or "parent"/,
  );

  assert.throws(
    () =>
      parseUltramodernBridgeCliOptions([
        '--bridge-parent-root=..',
        '--bridge-workspace-package=../packages/*',
        '--bridge-dependency=@acme/domain-core',
        '--bridge-gate-cwd=typecheck=..',
      ]),
    /without a matching --bridge-gate/,
  );
});

test('bridge mode rejects parent packages that collide with generated app dependencies', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-bridge-'));
  const workspaceDir = path.join(tempRoot, 'bridge-app');

  try {
    assert.throws(
      () =>
        generateUltramodernWorkspace({
          targetDir: workspaceDir,
          packageName: 'bridge-app',
          modernVersion: '3.2.1',
          packageSource: {
            strategy: 'workspace',
          },
          bridge: {
            parentRoot: '../..',
            workspacePackages: [
              {
                pattern: '../../packages/react',
                packageNames: ['react'],
              },
            ],
            dependencies: ['react'],
            gates: [
              {
                name: 'parent-rstest',
                command: 'pnpm exec rstest packages/react/tests',
                cwd: '../..',
              },
            ],
          },
        }),
      /Bridge mode dependency "react" conflicts with generated app dependency/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('bridge mode materializes workspace packages, app dependencies, compact config, and delegated gates', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-bridge-'));
  const workspaceDir = path.join(tempRoot, 'bridge-app');

  try {
    generateUltramodernWorkspace({
      targetDir: workspaceDir,
      packageName: 'bridge-app',
      modernVersion: '3.2.1',
      packageSource: {
        strategy: 'workspace',
      },
      bridge: {
        parentRoot: '../..',
        workspacePackages: [
          {
            pattern: '../../packages/domain-core',
            packageNames: ['@acme/domain-core'],
            testAliases: [
              {
                alias: '@acme/domain-core',
                target: '../../packages/domain-core/src/index.ts',
              },
              {
                alias: '@acme/domain-core/testing',
                target: '../../packages/domain-core/src/testing.ts',
              },
            ],
          },
          {
            pattern: '../../packages/domain-react',
            packageNames: ['@acme/domain-react'],
            testAliases: [
              {
                alias: '@acme/domain-react',
                target: '../../packages/domain-react/src/index.tsx',
              },
            ],
          },
        ],
        dependencies: ['@acme/domain-core', '@acme/domain-react'],
        lockfilePolicy: 'parent',
        gates: [
          {
            name: 'parent-rstest',
            command:
              'pnpm exec rstest packages/domain-core/tests packages/domain-react/tests',
            cwd: '../..',
          },
          {
            name: 'parent-typecheck',
            command:
              'pnpm exec tsc -b packages/domain-core packages/domain-react',
            cwd: '../..',
          },
        ],
        reactSingletons: ['react', 'react-dom', 'scheduler'],
      },
    });

    const rootPackage = readJson(workspaceDir, 'package.json');
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    const compactConfig = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const pnpmWorkspace = yaml.load(
      fs.readFileSync(path.join(workspaceDir, 'pnpm-workspace.yaml'), 'utf-8'),
    ) as { packages: string[] };

    assert.deepEqual(rootPackage.workspaces, [
      'apps/*',
      'verticals/*',
      'packages/*',
      '../../packages/domain-core',
      '../../packages/domain-react',
    ]);
    assert.ok(pnpmWorkspace.packages.includes('../../packages/domain-core'));
    assert.ok(pnpmWorkspace.packages.includes('../../packages/domain-react'));
    assert.equal(shellPackage.dependencies['@acme/domain-core'], 'workspace:*');
    assert.equal(
      shellPackage.dependencies['@acme/domain-react'],
      'workspace:*',
    );
    assert.equal(compactConfig.bridge.enabled, true);
    assert.equal(compactConfig.bridge.parentRoot, '../..');
    assert.equal(compactConfig.bridge.lockfilePolicy, 'parent');
    assert.deepEqual(compactConfig.bridge.dependencies, [
      '@acme/domain-core',
      '@acme/domain-react',
    ]);
    assert.deepEqual(compactConfig.bridge.reactSingletons, [
      'react',
      'react-dom',
      'scheduler',
    ]);
    assert.deepEqual(compactConfig.bridge.workspacePackages[0].testAliases, [
      {
        alias: '@acme/domain-core',
        target: '../../packages/domain-core/src/index.ts',
      },
      {
        alias: '@acme/domain-core/testing',
        target: '../../packages/domain-core/src/testing.ts',
      },
    ]);
    assert.equal(
      rootPackage.scripts.typecheck,
      'pnpm -r --filter "./apps/*" --filter "./verticals/*" --filter "./packages/*" run typecheck',
    );
    assert.equal(
      rootPackage.scripts['bridge:parent-rstest'],
      'cd ../.. && pnpm exec rstest packages/domain-core/tests packages/domain-react/tests',
    );
    assert.equal(
      rootPackage.scripts['bridge:parent-typecheck'],
      'cd ../.. && pnpm exec tsc -b packages/domain-core packages/domain-react',
    );
    assert.equal(
      rootPackage.scripts['bridge:check'],
      'pnpm run bridge:parent-rstest && pnpm run bridge:parent-typecheck',
    );
    assert.match(rootPackage.scripts.check, /pnpm bridge:check/u);

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    const rootPackageAfterVertical = readJson(workspaceDir, 'package.json');
    const catalogPackage = readJson(
      workspaceDir,
      'verticals/catalog/package.json',
    );
    const compactConfigAfterVertical = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );

    assert.equal(
      catalogPackage.dependencies['@acme/domain-core'],
      'workspace:*',
    );
    assert.equal(
      catalogPackage.dependencies['@acme/domain-react'],
      'workspace:*',
    );
    assert.equal(compactConfigAfterVertical.bridge.enabled, true);
    assert.deepEqual(compactConfigAfterVertical.bridge.dependencies, [
      '@acme/domain-core',
      '@acme/domain-react',
    ]);
    assert.equal(
      rootPackageAfterVertical.scripts['bridge:check'],
      'pnpm run bridge:parent-rstest && pnpm run bridge:parent-typecheck',
    );
    assert.match(rootPackageAfterVertical.scripts.check, /pnpm bridge:check/u);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

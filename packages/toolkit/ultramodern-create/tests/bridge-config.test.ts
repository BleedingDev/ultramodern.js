import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

type RecordedCommand = {
  argv: string[];
  cwd: string;
};

const createCommandRecorder = (root: string) => {
  const binDir = path.join(root, 'command-recorder-bin');
  const logPath = path.join(root, 'command-recorder.ndjson');
  const executablePath = path.join(binDir, 'pnpm');

  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    executablePath,
    `#!/usr/bin/env node
const fs = require('node:fs');

const argv = process.argv.slice(2);
fs.appendFileSync(
  process.env.ULTRAMODERN_COMMAND_LOG,
  JSON.stringify({ argv, cwd: process.cwd() }) + '\\n',
);

const failArgv = process.env.ULTRAMODERN_FAIL_ARGV
  ? JSON.parse(process.env.ULTRAMODERN_FAIL_ARGV)
  : undefined;
if (failArgv && JSON.stringify(argv) === JSON.stringify(failArgv)) {
  process.exit(73);
}
`,
    'utf-8',
  );
  fs.chmodSync(executablePath, 0o755);

  return {
    clear() {
      fs.rmSync(logPath, { force: true });
    },
    env(failArgv?: string[]): NodeJS.ProcessEnv {
      return {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        ULTRAMODERN_COMMAND_LOG: logPath,
        ...(failArgv
          ? { ULTRAMODERN_FAIL_ARGV: JSON.stringify(failArgv) }
          : {}),
      };
    },
    read(): RecordedCommand[] {
      if (!fs.existsSync(logPath)) {
        return [];
      }

      return fs
        .readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as RecordedCommand);
    },
  };
};

const runGeneratedScript = (
  workspaceRoot: string,
  packageJson: { scripts?: Record<string, string> },
  scriptName: string,
  commandRecorder: ReturnType<typeof createCommandRecorder>,
  failArgv?: string[],
) => {
  const command = packageJson.scripts?.[scriptName];
  assert.equal(typeof command, 'string');

  return spawnSync(command, {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    env: commandRecorder.env(failArgv),
    shell: true,
  });
};

const assertScriptPassed = (result: ReturnType<typeof spawnSync>) => {
  assert.equal(
    result.status,
    0,
    `generated script failed:\n${String(result.stdout)}\n${String(result.stderr)}`,
  );
};

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
    reactSingletons: [
      'react',
      'react-dom',
      'react-dom/client',
      'react',
      'scheduler',
    ],
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
    reactSingletons: ['react', 'react-dom', 'react-dom/client', 'scheduler'],
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
    'react,react-dom,react-dom/client,scheduler',
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
    reactSingletons: ['react', 'react-dom', 'react-dom/client', 'scheduler'],
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
    /React singleton\/dedupe declarations must include react and react-dom and react-dom\/client/,
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
        reactSingletons: [
          'react',
          'react-dom',
          'react-dom/client',
          'scheduler',
        ],
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
      'react-dom/client',
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
    const commandRecorder = createCommandRecorder(tempRoot);
    const canonicalWorkspaceDir = fs.realpathSync(workspaceDir);
    const canonicalParentDir = fs.realpathSync(
      path.resolve(workspaceDir, '../..'),
    );
    const typecheckInvocation: RecordedCommand = {
      argv: [
        '-r',
        '--filter',
        './apps/*',
        '--filter',
        './verticals/*',
        '--filter',
        './packages/*',
        'run',
        'typecheck',
      ],
      cwd: canonicalWorkspaceDir,
    };
    const parentRstestInvocation: RecordedCommand = {
      argv: [
        'exec',
        'rstest',
        'packages/domain-core/tests',
        'packages/domain-react/tests',
      ],
      cwd: canonicalParentDir,
    };
    const parentTypecheckInvocation: RecordedCommand = {
      argv: [
        'exec',
        'tsc',
        '-b',
        'packages/domain-core',
        'packages/domain-react',
      ],
      cwd: canonicalParentDir,
    };
    const bridgeCheckInvocations: RecordedCommand[] = [
      {
        argv: ['run', 'bridge:parent-rstest'],
        cwd: canonicalWorkspaceDir,
      },
      {
        argv: ['run', 'bridge:parent-typecheck'],
        cwd: canonicalWorkspaceDir,
      },
    ];
    const composedCheckInvocations: RecordedCommand[] = [
      'format:check',
      'lint',
      'typecheck',
      'skills:check',
      'i18n:boundaries',
      'api:check',
      'contract:check',
      'performance:readiness',
      'bridge:check',
    ].map(scriptName => ({
      argv: [scriptName],
      cwd: canonicalWorkspaceDir,
    }));

    commandRecorder.clear();
    assertScriptPassed(
      runGeneratedScript(
        workspaceDir,
        rootPackage,
        'typecheck',
        commandRecorder,
      ),
    );
    assert.deepEqual(commandRecorder.read(), [typecheckInvocation]);

    commandRecorder.clear();
    assertScriptPassed(
      runGeneratedScript(
        workspaceDir,
        rootPackage,
        'bridge:parent-rstest',
        commandRecorder,
      ),
    );
    assert.deepEqual(commandRecorder.read(), [parentRstestInvocation]);

    commandRecorder.clear();
    assertScriptPassed(
      runGeneratedScript(
        workspaceDir,
        rootPackage,
        'bridge:parent-typecheck',
        commandRecorder,
      ),
    );
    assert.deepEqual(commandRecorder.read(), [parentTypecheckInvocation]);

    commandRecorder.clear();
    assertScriptPassed(
      runGeneratedScript(
        workspaceDir,
        rootPackage,
        'bridge:check',
        commandRecorder,
      ),
    );
    assert.deepEqual(commandRecorder.read(), bridgeCheckInvocations);

    commandRecorder.clear();
    assertScriptPassed(
      runGeneratedScript(workspaceDir, rootPackage, 'check', commandRecorder),
    );
    assert.deepEqual(commandRecorder.read(), composedCheckInvocations);

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

    commandRecorder.clear();
    for (const scriptName of [
      'typecheck',
      'bridge:parent-rstest',
      'bridge:parent-typecheck',
      'bridge:check',
      'check',
    ]) {
      assertScriptPassed(
        runGeneratedScript(
          workspaceDir,
          rootPackageAfterVertical,
          scriptName,
          commandRecorder,
        ),
      );
    }
    assert.deepEqual(commandRecorder.read(), [
      typecheckInvocation,
      parentRstestInvocation,
      parentTypecheckInvocation,
      ...bridgeCheckInvocations,
      ...composedCheckInvocations,
    ]);

    commandRecorder.clear();
    const failedParentGate = runGeneratedScript(
      workspaceDir,
      rootPackageAfterVertical,
      'bridge:parent-typecheck',
      commandRecorder,
      parentTypecheckInvocation.argv,
    );
    assert.equal(failedParentGate.status, 73);
    assert.deepEqual(commandRecorder.read(), [parentTypecheckInvocation]);

    commandRecorder.clear();
    const failedBridgeCheck = runGeneratedScript(
      workspaceDir,
      rootPackageAfterVertical,
      'bridge:check',
      commandRecorder,
      bridgeCheckInvocations[0].argv,
    );
    assert.equal(failedBridgeCheck.status, 73);
    assert.deepEqual(commandRecorder.read(), [bridgeCheckInvocations[0]]);

    commandRecorder.clear();
    const failedComposedCheck = runGeneratedScript(
      workspaceDir,
      rootPackageAfterVertical,
      'check',
      commandRecorder,
      ['typecheck'],
    );
    assert.equal(failedComposedCheck.status, 73);
    assert.deepEqual(
      commandRecorder.read(),
      composedCheckInvocations.slice(0, 3),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

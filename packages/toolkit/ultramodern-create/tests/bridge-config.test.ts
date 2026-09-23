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
import {
  prependCommandFixturePath,
  writeNodeCommandFixture,
} from './helpers/node-command-fixture';
import { linkWorkspaceFormatterDependencies } from './helpers/workspace-kit';

const readJson = (root: string, relativePath: string) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf-8'));

type RecordedCommand = {
  argv: string[];
  cwd: string;
};

const createCommandRecorder = (root: string) => {
  const binDir = path.join(root, 'command-recorder-bin');
  const logPath = path.join(root, 'command-recorder.ndjson');
  writeNodeCommandFixture(
    binDir,
    'pnpm',
    `
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
  );

  return {
    clear() {
      fs.rmSync(logPath, { force: true });
    },
    env(failArgv?: string[]): NodeJS.ProcessEnv {
      return {
        ...prependCommandFixturePath(binDir),
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

  // Assert only what the normalizer actually transforms: duplicate-dedup on
  // packageNames/dependencies/reactSingletons, and the default lockfilePolicy
  // — not a restatement of the whole input shape.
  assert.deepEqual(bridge?.workspacePackages[0].packageNames, [
    '@acme/domain-core',
    '@acme/domain-events',
  ]);
  assert.deepEqual(bridge?.dependencies, [
    '@acme/domain-core',
    '@acme/domain-events',
  ]);
  assert.deepEqual(bridge?.reactSingletons, [
    'react',
    'react-dom',
    'react-dom/client',
    'scheduler',
  ]);
  assert.equal(bridge?.lockfilePolicy, 'nested');
});

test('bridge CLI parser rejects partial or invalid bridge mode', () => {
  assert.throws(
    () => parseUltramodernBridgeCliOptions(['--bridge']),
    /--bridge-parent-root must be a non-empty string/,
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

test('bridge mode materializes delegated gates and preserves external parent participants', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-bridge-'));
  const workspaceDir = path.join(tempRoot, 'apps/bridge-app');

  try {
    for (const name of ['domain-core', 'domain-react']) {
      const directory = path.join(tempRoot, 'packages', name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({ name: `@acme/${name}`, private: true }),
      );
    }
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
    const pnpmWorkspace = yaml.load(
      fs.readFileSync(path.join(workspaceDir, 'pnpm-workspace.yaml'), 'utf-8'),
    ) as { packages: string[] };

    assert.ok(pnpmWorkspace.packages.includes('../../packages/domain-core'));
    assert.ok(pnpmWorkspace.packages.includes('../../packages/domain-react'));
    assert.equal(shellPackage.dependencies['@acme/domain-core'], 'workspace:*');
    assert.equal(
      shellPackage.dependencies['@acme/domain-react'],
      'workspace:*',
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, '.modernjs/ultramodern.json')),
      false,
    );

    const commandRecorder = createCommandRecorder(tempRoot);
    const canonicalParentDir = fs.realpathSync(
      path.resolve(workspaceDir, '../..'),
    );
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

    // A bridged gate must actually run in the parent workspace, not the
    // generated app's own directory.
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

    // A failing parent gate must propagate its exit code instead of being
    // swallowed by the generated script wiring.
    commandRecorder.clear();
    const failedParentGate = runGeneratedScript(
      workspaceDir,
      rootPackage,
      'bridge:parent-typecheck',
      commandRecorder,
      parentTypecheckInvocation.argv,
    );
    assert.equal(failedParentGate.status, 73);
    assert.deepEqual(commandRecorder.read(), [parentTypecheckInvocation]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

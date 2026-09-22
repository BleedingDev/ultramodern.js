import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernShell,
  addUltramodernVertical,
  planUltramodernShell,
} from '../src/ultramodern-workspace';
import { UnknownUltramodernShellError } from '../src/ultramodern-workspace/add-vertical/preflight';
import { sharedPackages } from '../src/ultramodern-workspace/descriptors';
import {
  prependCommandFixturePath,
  writeNodeCommandFixture,
} from './helpers/node-command-fixture';
import { createWorkspace, runValidation } from './helpers/workspace-kit';

const createBinPath = path.resolve(__dirname, '../bin/run.js');
const nativePreviewRequire = createRequire(
  createRequire(import.meta.url).resolve(
    '@typescript/native-preview/package.json',
  ),
);
const nativeCompiler = path.join(
  path.dirname(
    nativePreviewRequire.resolve(
      `@typescript/native-preview-${process.platform}-${process.arch}/package.json`,
    ),
  ),
  'lib',
  process.platform === 'win32' ? 'tsgo.exe' : 'tsgo',
);

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function createBaseWorkspace(workspaceDir: string) {
  createWorkspace(workspaceDir);
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
}

type RecordedBuildInvocation = {
  argv: string[];
  cwd: string;
};

function runRecordedRootBuild(
  workspaceDir: string,
  options: { failFilter?: string } = {},
) {
  const recorderRoot = fs.mkdtempSync(
    path.join(path.dirname(workspaceDir), 'build-recorder-'),
  );
  const binDir = path.join(recorderRoot, 'bin');
  const invocationLog = path.join(recorderRoot, 'invocations.jsonl');
  writeNodeCommandFixture(
    binDir,
    'pnpm',
    `
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(
  process.env.ULTRAMODERN_TEST_BUILD_LOG,
  JSON.stringify({ argv, cwd: process.cwd() }) + '\\n',
);
if (argv.includes(process.env.ULTRAMODERN_TEST_FAIL_FILTER)) {
  process.exit(23);
}
`,
  );
  // Exercise the generated prebuild with a real compiler and a dependency-free fixture.
  for (const { directory } of sharedPackages) {
    const fixtureRoot = path.join(workspaceDir, directory);
    fs.writeFileSync(
      path.join(fixtureRoot, 'root-build-fixture.ts'),
      'export const buildContract: string = "checked";\n',
    );
    fs.writeFileSync(
      path.join(fixtureRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          composite: true,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: './dist',
          types: [],
        },
        files: ['root-build-fixture.ts'],
      }),
    );
  }

  const rootPackage = readJson(workspaceDir, 'package.json');
  const result = spawnSync(rootPackage.scripts.build, {
    cwd: workspaceDir,
    encoding: 'utf-8',
    env: {
      ...prependCommandFixturePath(binDir),
      EFFECT_TSGO_BIN: nativeCompiler,
      ULTRAMODERN_CREATE_BIN: createBinPath,
      ULTRAMODERN_TEST_BUILD_LOG: invocationLog,
      ULTRAMODERN_TEST_FAIL_FILTER: options.failFilter ?? '',
    },
    shell: true,
  });
  const invocations = fs.existsSync(invocationLog)
    ? fs
        .readFileSync(invocationLog, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as RecordedBuildInvocation)
    : [];
  return { invocations, result };
}

test('root build executes every shell before and after adding a vertical and propagates failures', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  const expectedInvocations = [
    ['-r', '--filter', './verticals/*', 'run', 'build'],
    ['--filter', './apps/shell-super-app', 'run', 'build'],
    ['--filter', './apps/shell-admin', 'run', 'build'],
    ['mf:types'],
    ['performance:readiness'],
  ];
  try {
    createBaseWorkspace(workspaceDir);
    addUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });

    const buildBeforeVertical = runRecordedRootBuild(workspaceDir);
    assert.equal(
      buildBeforeVertical.result.status,
      0,
      `${buildBeforeVertical.result.stdout}\n${buildBeforeVertical.result.stderr}`,
    );
    assert.deepEqual(
      buildBeforeVertical.invocations.map(invocation => invocation.argv),
      expectedInvocations,
    );
    for (const { directory } of sharedPackages) {
      assert.equal(
        fs.existsSync(
          path.join(workspaceDir, directory, 'dist/root-build-fixture.d.ts'),
        ),
        true,
        'shared declaration prebuilds must run before shell commands',
      );
    }
    assert.ok(
      buildBeforeVertical.invocations.every(
        invocation => invocation.cwd === fs.realpathSync(workspaceDir),
      ),
    );

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'orders',
      modernVersion: '3.2.1',
    });
    const buildAfterVertical = runRecordedRootBuild(workspaceDir);
    assert.equal(
      buildAfterVertical.result.status,
      0,
      `${buildAfterVertical.result.stdout}\n${buildAfterVertical.result.stderr}`,
    );
    assert.deepEqual(
      buildAfterVertical.invocations.map(invocation => invocation.argv),
      expectedInvocations,
    );

    // A shell build failure is returned by the root build and stops later
    // shells and post-build gates from running.
    const failedBuild = runRecordedRootBuild(workspaceDir, {
      failFilter: './apps/shell-super-app',
    });
    assert.equal(failedBuild.result.status, 23);
    assert.deepEqual(
      failedBuild.invocations.map(invocation => invocation.argv),
      [
        ['-r', '--filter', './verticals/*', 'run', 'build'],
        ['--filter', './apps/shell-super-app', 'run', 'build'],
      ],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('add-vertical targets an additional shell and rejects unknown shell ids during preflight', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    createBaseWorkspace(workspaceDir);
    addUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'orders',
      modernVersion: '3.2.1',
      shell: 'shell-admin',
    });

    const config = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const primary = config.topology.apps.find(
      (app: { id?: string }) => app.id === 'shell-super-app',
    );
    const additional = config.shells.find(
      (shell: { id?: string }) => shell.id === 'shell-admin',
    );
    assert.deepEqual(primary.moduleFederation.verticalRefs, ['catalog']);
    assert.deepEqual(additional.verticalRefs, ['catalog', 'orders']);
    assert.ok(
      additional.moduleFederation.remotes.some(
        (remote: { id?: string }) => remote.id === 'orders',
      ),
    );

    const primaryPackage = readJson(
      workspaceDir,
      'apps/shell-super-app/package.json',
    );
    const additionalPackage = readJson(
      workspaceDir,
      'apps/shell-admin/package.json',
    );
    // API surface is full mesh: every shell re-exports each API unit's client
    // (plain workspace dep), even when the unit composes into another shell.
    assert.equal(
      primaryPackage.dependencies['@workspace/orders'],
      'workspace:*',
    );
    // Composition stays target-scoped: no Zephyr/MF wiring on the primary.
    assert.equal(primaryPackage['zephyr:dependencies']?.orders, undefined);
    assert.equal(
      additionalPackage.dependencies['@workspace/orders'],
      'workspace:*',
    );
    assert.equal(
      additionalPackage['zephyr:dependencies'].orders,
      '@workspace/orders@workspace:*',
    );

    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    assert.deepEqual(topology.shell.verticalRefs, ['catalog']);
    assert.deepEqual(
      topology.shell.moduleFederation.remotes.map(
        (remote: { id: string }) => remote.id,
      ),
      ['catalog'],
    );
    const validation = runValidation(workspaceDir);
    assert.equal(
      validation.status,
      0,
      `${validation.stdout}\n${validation.stderr}`,
    );

    assert.throws(
      () =>
        addUltramodernVertical({
          workspaceRoot: workspaceDir,
          name: 'payments',
          modernVersion: '3.2.1',
          shell: 'shell-missing',
        }),
      error => {
        assert.ok(error instanceof UnknownUltramodernShellError);
        assert.equal(error.code, 'ULTRAMODERN_UNKNOWN_TARGET_SHELL');
        assert.deepEqual(error.issue, {
          field: 'shell',
          value: 'shell-missing',
          reason: 'unknown',
          available: ['shell-super-app', 'shell-admin'],
        });
        return true;
      },
    );
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/payments')),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('workspace-wide port allocation avoids customized shell and overlay ports', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    createBaseWorkspace(workspaceDir);

    const overlayPath = path.join(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    overlay.ports.catalog = 3120;
    fs.writeFileSync(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);

    addUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });
    addUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'partner',
      modernVersion: '3.2.1',
    });
    const configAfterShell = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    assert.deepEqual(
      configAfterShell.shells.map((shell: { id: string }) => shell.id),
      ['shell-admin', 'shell-partner'],
    );
    assert.deepEqual(
      configAfterShell.shells.map((shell: { port: number }) => shell.port),
      [3121, 3122],
    );
    assert.equal(
      new Set(
        configAfterShell.shells.map((shell: { port: number }) => shell.port),
      ).size,
      2,
      'additional shell ports are distinct',
    );

    const rootTsConfig = readJson(workspaceDir, 'tsconfig.json');
    const referencePaths = (rootTsConfig.references ?? []).map(
      (reference: { path?: string }) => reference.path,
    );
    assert.ok(referencePaths.includes('apps/shell-admin'));
    assert.ok(referencePaths.includes('apps/shell-partner'));

    configAfterShell.shells[0].port = 4101;
    fs.writeFileSync(
      path.join(workspaceDir, '.modernjs/ultramodern.json'),
      `${JSON.stringify(configAfterShell, null, 2)}\n`,
    );
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'orders',
      modernVersion: '3.2.1',
    });
    const configAfterVertical = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    const orders = configAfterVertical.topology.apps.find(
      (app: { id?: string }) => app.id === 'orders',
    );
    assert.equal(orders.port, 4102);
    assert.deepEqual(
      configAfterVertical.shells.map((shell: { id: string }) => shell.id),
      ['shell-admin', 'shell-partner'],
    );
    assert.equal(configAfterVertical.shells[0].port, 4101);
    assert.equal(configAfterVertical.shells[1].port, 3122);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('planUltramodernShell reports the planned shell without mutating the workspace', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    createBaseWorkspace(workspaceDir);

    const plan = planUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });

    assert.equal(plan.dryRun, true);
    assert.equal(plan.operation, 'shell');
    assert.ok(
      plan.createdPaths.some(created =>
        created.startsWith('apps/shell-admin/'),
      ),
      'plan reports the scaffolded shell paths',
    );
    // Dry-run must not touch the real workspace.
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'apps/shell-admin')),
      false,
    );
    assert.equal(
      (readJson(workspaceDir, '.modernjs/ultramodern.json').shells ?? [])
        .length,
      0,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('add-shell keeps consumer-authored root scripts and tsconfig bytes', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    createBaseWorkspace(workspaceDir);
    const packagePath = path.join(workspaceDir, 'package.json');
    const manifest = readJson(workspaceDir, 'package.json');
    manifest.scripts['consumer:check'] = 'echo authored';
    manifest.scripts.build = 'echo authored-build';
    fs.writeFileSync(packagePath, JSON.stringify(manifest, null, 2));
    const configPath = path.join(workspaceDir, '.modernjs/ultramodern.json');
    const config = readJson(workspaceDir, '.modernjs/ultramodern.json');
    config.topology.apps.find(
      (app: { id: string }) => app.id === 'shell-super-app',
    ).moduleFederation.verticalRefs = [];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    const tsconfigPath = path.join(workspaceDir, 'tsconfig.json');
    const authoredTsconfig =
      '{"references":[],"compilerOptions":{"strict":true},"extra":"authored"}\n';
    fs.writeFileSync(tsconfigPath, authoredTsconfig);

    addUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });

    const next = readJson(workspaceDir, 'package.json');
    assert.equal(next.scripts['consumer:check'], 'echo authored');
    assert.equal(next.scripts.build, 'echo authored-build');
    assert.equal(fs.readFileSync(tsconfigPath, 'utf-8'), authoredTsconfig);
    assert.deepEqual(
      readJson(workspaceDir, '.modernjs/ultramodern.json').topology.apps.find(
        (app: { id: string }) => app.id === 'shell-super-app',
      ).moduleFederation.verticalRefs,
      [],
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

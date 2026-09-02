import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernShell,
  addUltramodernVertical,
  generateUltramodernWorkspace,
  planUltramodernShell,
} from '../src/ultramodern-workspace';
import { UnknownUltramodernShellError } from '../src/ultramodern-workspace/add-vertical/preflight';

const createBinPath = path.resolve(__dirname, '../bin/run.js');

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function createBaseWorkspace(workspaceDir: string) {
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: path.basename(workspaceDir),
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
}

function runValidation(workspaceDir: string) {
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    { cwd: workspaceDir, encoding: 'utf-8' },
  );
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
  const fakePnpm = path.join(binDir, 'pnpm');
  const fakeTsgo = path.join(binDir, 'tsgo');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    fakePnpm,
    `#!/usr/bin/env node
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
  fs.chmodSync(fakePnpm, 0o755);
  fs.writeFileSync(fakeTsgo, '#!/usr/bin/env node\n');
  fs.chmodSync(fakeTsgo, 0o755);

  const rootPackage = readJson(workspaceDir, 'package.json');
  const result = spawnSync(rootPackage.scripts.build, {
    cwd: workspaceDir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      EFFECT_TSGO_BIN: fakeTsgo,
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

test('addUltramodernShell scaffolds an additional shell delivery unit and keeps the workspace valid', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    createBaseWorkspace(workspaceDir);

    const result = addUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });

    assert.equal(result.operation, 'shell');
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'apps/shell-admin/package.json')),
      true,
    );

    // Distinct delivery-unit identity: id, package, port, MF host name.
    const shellPackage = readJson(
      workspaceDir,
      'apps/shell-admin/package.json',
    );
    assert.equal(
      shellPackage.name,
      `@${path.basename(workspaceDir)}/shell-admin`,
    );

    const config = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const registered = (config.shells ?? []).find(
      (entry: { id?: string }) => entry.id === 'shell-admin',
    );
    assert.ok(registered, 'additional shell registered in config.shells');
    assert.equal(registered.mfName, 'shellAdmin');
    assert.notEqual(registered.port, 3020);
    assert.ok(
      registered.deliveryUnit,
      'additional shell has delivery-unit identity',
    );
    assert.deepEqual(registered.owner, {
      kind: 'team',
      id: 'super-app-platform',
    });
    assert.equal(registered.deliveryUnit.unitId, 'workspace/shell-admin');
    assert.equal(typeof registered.deliveryUnit.buildMarker, 'string');
    assert.deepEqual(registered.verticalRefs, ['catalog']);

    // The additional shell's dev port is recorded only in config.shells — the
    // development overlay is not mutated (G28 decision).
    assert.equal(typeof registered.port, 'number');
    const overlay = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    assert.ok(
      !Object.hasOwn(overlay.ports ?? {}, 'shell-admin'),
      'development overlay must not record the additional shell port',
    );
    assert.ok(
      !Object.values(overlay.ports ?? {}).includes(registered.port),
      'additional shell port must not leak into the development overlay',
    );

    // The additional shell joins the root TS-Go project-reference graph.
    const rootTsConfig = readJson(workspaceDir, 'tsconfig.json');
    assert.ok(
      (rootTsConfig.references ?? []).some(
        (reference: { path?: string }) => reference.path === 'apps/shell-admin',
      ),
      'root tsconfig references the additional shell',
    );

    const shellPackageModern = readJson(
      workspaceDir,
      'apps/shell-admin/package.json',
    );
    assert.equal(shellPackageModern.modernjs.appId, 'shell-admin');
    const buildArtifact = readJson(
      workspaceDir,
      'apps/shell-admin/shared/ultramodern-build.json',
    );
    assert.equal(buildArtifact.deliveryUnit.appId, 'shell-admin');
    assert.equal(
      buildArtifact.deliveryUnit.buildMarker,
      registered.deliveryUnit.buildMarker,
    );

    // The generated validator still passes with the additional shell present —
    // both shells clear the structural thin-shell gate (G30a x G28).
    const validation = runValidation(workspaceDir);
    assert.equal(
      validation.status,
      0,
      `${validation.stdout}\n${validation.stderr}`,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

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
      buildBeforeVertical.result.stderr,
    );
    assert.deepEqual(
      buildBeforeVertical.invocations.map(invocation => invocation.argv),
      expectedInvocations,
    );
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
      buildAfterVertical.result.stderr,
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

test('add-shell followed by add-vertical preserves every shell-derived artifact', () => {
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
    });

    const config = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(config.shells.length, 1);
    assert.equal(config.shells[0].id, 'shell-admin');
    assert.deepEqual(config.shells[0].verticalRefs, ['catalog']);
    assert.ok(
      readJson(workspaceDir, 'tsconfig.json').references.some(
        (reference: { path?: string }) => reference.path === 'apps/shell-admin',
      ),
    );
    const validation = runValidation(workspaceDir);
    assert.equal(
      validation.status,
      0,
      `${validation.stdout}\n${validation.stderr}`,
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
    const configAfterShell = readJson(
      workspaceDir,
      '.modernjs/ultramodern.json',
    );
    assert.equal(configAfterShell.shells[0].port, 3121);

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
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('add-shell honors a customized primary-shell overlay port during allocation', () => {
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
    // Operator moved the primary shell onto the first additional-shell slot.
    overlay.ports['shell-super-app'] = 3120;
    fs.writeFileSync(overlayPath, `${JSON.stringify(overlay, null, 2)}\n`);

    addUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });

    // The newly allocated additional shell must skip the customized primary
    // port (3120) instead of colliding with it.
    const config = readJson(workspaceDir, '.modernjs/ultramodern.json');
    assert.equal(config.shells[0].port, 3121);

    // add-shell must not mutate the development overlay (G28): the primary
    // shell keeps its customized port untouched.
    const overlayAfter = readJson(
      workspaceDir,
      'topology/local-overlays/development.json',
    );
    assert.equal(overlayAfter.ports['shell-super-app'], 3120);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('the structural thin-shell gate rejects a business surface in an additional shell', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    createBaseWorkspace(workspaceDir);
    addUltramodernShell({
      workspaceRoot: workspaceDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });

    // A thin Shell must own no API surface. Planting api/ inside the additional
    // shell must fail the generated validator — proving the gate covers every
    // configured shell, not just the primary one.
    fs.mkdirSync(path.join(workspaceDir, 'apps/shell-admin/api'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(workspaceDir, 'apps/shell-admin/api/index.ts'),
      'export const handler = () => new Response("no");\n',
    );

    const validation = runValidation(workspaceDir);
    assert.notEqual(validation.status, 0);
    assert.match(
      `${validation.stdout}\n${validation.stderr}`,
      /thin Shell must not own an API surface/,
    );
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

test('a workspace supports multiple additional shells with distinct ports', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    createBaseWorkspace(workspaceDir);
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

    const config = readJson(workspaceDir, '.modernjs/ultramodern.json');
    const ids = (config.shells ?? []).map((entry: { id: string }) => entry.id);
    assert.deepEqual(ids.toSorted(), ['shell-admin', 'shell-partner']);

    const ports = (config.shells ?? []).map(
      (entry: { port: number }) => entry.port,
    );
    assert.equal(new Set(ports).size, ports.length, 'shell ports are distinct');

    // Both additional shells join the root TS-Go project-reference graph and the
    // workspace still clears every generated contract, including the thin-shell
    // gate for all three shells.
    const rootTsConfig = readJson(workspaceDir, 'tsconfig.json');
    const referencePaths = (rootTsConfig.references ?? []).map(
      (reference: { path?: string }) => reference.path,
    );
    assert.ok(referencePaths.includes('apps/shell-admin'));
    assert.ok(referencePaths.includes('apps/shell-partner'));

    const validation = runValidation(workspaceDir);
    assert.equal(
      validation.status,
      0,
      `${validation.stdout}\n${validation.stderr}`,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('addUltramodernShell rejects the reserved primary-shell name', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-add-shell-'));
  const workspaceDir = path.join(tempRoot, 'workspace');
  try {
    createBaseWorkspace(workspaceDir);
    assert.throws(
      () =>
        addUltramodernShell({
          workspaceRoot: workspaceDir,
          name: 'super-app',
          modernVersion: '3.2.1',
        }),
      /reserved for the primary shell/,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

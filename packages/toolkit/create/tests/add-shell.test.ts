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

    // Root scripts enumerate every configured shell.
    const rootPackage = readJson(workspaceDir, 'package.json');
    assert.match(rootPackage.scripts.build, /apps\/shell-super-app.*run build/);
    assert.match(rootPackage.scripts.build, /apps\/shell-admin.*run build/);

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

    const shellModernConfig = fs.readFileSync(
      path.join(workspaceDir, 'apps/shell-admin/modern.config.ts'),
      'utf-8',
    );
    for (const port of [3020, 3120, 4101]) {
      assert.match(shellModernConfig, new RegExp(`http://localhost:${port}`));
    }
    assert.match(shellModernConfig, /credentials: false/);
    assert.doesNotMatch(shellModernConfig, /origin:\s*true|origin:\s*'\*'/u);
    const shellMfConfig = fs.readFileSync(
      path.join(workspaceDir, 'apps/shell-admin/module-federation.config.ts'),
      'utf-8',
    );
    assert.match(shellMfConfig, /name: 'shellAdmin'/);
    assert.doesNotMatch(shellMfConfig, /name: 'shellSuperApp'/);
    assert.match(
      fs.readFileSync(
        path.join(workspaceDir, 'apps/shell-admin/src/routes/index.css'),
        'utf-8',
      ),
      /prefix\(shelladmin\)/,
    );
    const shellComponents = fs.readFileSync(
      path.join(
        workspaceDir,
        'apps/shell-admin/src/routes/vertical-components.tsx',
      ),
      'utf-8',
    );
    assert.match(shellComponents, /data-modern-boundary-id="shellAdmin"/);
    assert.match(shellComponents, /shelladmin:text-red-900/);
    assert.doesNotMatch(shellComponents, /data-modern-boundary-id="shellSuperApp"/);

    const zeropsYaml = fs.readFileSync(
      path.join(workspaceDir, 'zerops.yaml'),
      'utf-8',
    );
    assert.match(zeropsYaml, /setup: 'shell-admin'/);
    assert.match(
      zeropsYaml,
      /start: cd '\.zerops\/runtime\/shell-admin' && npm run serve/,
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
    assert.equal(primaryPackage.dependencies['@workspace/orders'], undefined);
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
    assert.match(
      fs.readFileSync(
        path.join(workspaceDir, 'apps/shell-admin/module-federation.config.ts'),
        'utf-8',
      ),
      /name: 'shellAdmin'[\s\S]*catalog:[\s\S]*orders:/u,
    );
    assert.match(
      fs.readFileSync(
        path.join(workspaceDir, 'apps/shell-admin/src/routes/index.css'),
        'utf-8',
      ),
      /prefix\(shelladmin\)/,
    );
    assert.match(
      fs.readFileSync(
        path.join(
          workspaceDir,
          'apps/shell-admin/src/routes/vertical-components.tsx',
        ),
        'utf-8',
      ),
      /data-modern-boundary-id="shellAdmin"/,
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
    assert.match(
      readJson(workspaceDir, 'package.json').scripts.build,
      /apps\/shell-admin.*run build/,
    );
    assert.match(
      fs.readFileSync(path.join(workspaceDir, 'zerops.yaml'), 'utf-8'),
      /setup: 'shell-admin'/,
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

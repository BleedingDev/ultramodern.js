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

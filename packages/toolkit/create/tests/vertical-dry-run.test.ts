import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
  planUltramodernVertical,
} from '../src/ultramodern-workspace';
import { createWorkspace, snapshotWorkspace } from './helpers/workspace-kit';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
};

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv,
  });
}

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function writeJson(workspaceDir: string, relativePath: string, value: unknown) {
  fs.writeFileSync(
    path.join(workspaceDir, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf-8',
  );
}

function addSyntheticTopologyVertical(
  workspaceDir: string,
  options: { id: string; port: number },
) {
  const topologyPath = 'topology/reference-topology.json';
  const overlayPath = 'topology/local-overlays/development.json';
  const topology = readJson(workspaceDir, topologyPath);
  const overlay = readJson(workspaceDir, overlayPath);

  topology.verticals.push({
    id: options.id,
    kind: 'vertical',
    domain: options.id,
    package: `@dry-run-workspace/${options.id}`,
    path: `verticals/${options.id}`,
    moduleFederation: {
      role: 'remote',
      name: 'verticalSynthetic',
      manifestUrl: `http://localhost:${options.port}/mf-manifest.json`,
      exposes: ['./Route', './Widget'],
      ssr: true,
      sharedContractVersion: 'mf-ssr-contract-v1',
    },
    api: {
      effect: {
        bff: {
          prefix: `/${options.id}-api`,
        },
      },
    },
  });
  overlay.ports[options.id] = options.port;
  writeJson(workspaceDir, topologyPath, topology);
  writeJson(workspaceDir, overlayPath, overlay);
}

test('public dry-run plan leaves workspace unchanged and matches normal run summary', () => {
  const { tempRoot, workspaceDir } = createWorkspace('dry-run-workspace', {
    tempPrefix: 'um-vertical-dry-',
  });

  try {
    const before = snapshotWorkspace(workspaceDir);
    const plan = planUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
    assert.equal(plan.dryRun, true);
    assert.equal(plan.selectedPort, 4101);
    assert.deepEqual(plan.moduleFederationRemote, {
      id: 'catalog',
      name: 'verticalCatalog',
      manifestUrl: 'http://localhost:4101/mf-manifest.json',
    });
    assert.equal(plan.apiPrefix, '/catalog-api');
    assert.ok(
      plan.createdPaths.includes('verticals/catalog/package.json'),
      'dry-run must report paths it would create',
    );
    assert.ok(
      plan.rewrittenPaths.includes('topology/reference-topology.json'),
      'dry-run must report paths it would rewrite',
    );
    assert.ok(
      plan.jsonMutations.some(
        mutation =>
          mutation.path === 'topology/reference-topology.json' &&
          mutation.pointer === '/verticals/-',
      ),
      'dry-run must report topology JSON mutations',
    );
    assert.deepEqual(plan.shellDependencyChanges, [
      {
        path: 'apps/shell-super-app/package.json',
        section: 'zephyr:dependencies',
        packageName: 'catalog',
        version: '@dry-run-workspace/catalog@workspace:*',
      },
      {
        path: 'apps/shell-super-app/package.json',
        section: 'dependencies',
        packageName: '@dry-run-workspace/catalog',
        version: 'workspace:*',
      },
    ]);
    assert.deepEqual(plan.generatedContractChanges, [
      {
        path: '.modernjs/ultramodern.json',
        addedAppIds: ['catalog'],
        shellVerticalRefs: ['catalog'],
      },
    ]);

    const result = addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assert.deepEqual(plan.createdApps, result.createdApps);
    assert.deepEqual(plan.createdPaths, result.createdPaths);
    assert.deepEqual(plan.rewrittenPaths, result.rewrittenPaths);
    assert.deepEqual(plan.assignedPorts, result.assignedPorts);
    assert.deepEqual(plan.moduleFederationNames, result.moduleFederationNames);
    assert.deepEqual(plan.apiPrefixes, result.apiPrefixes);
    assert.equal(plan.generatedContractPath, result.generatedContractPath);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('dry-run reports validation failures without modifying the workspace', () => {
  const duplicateName = createWorkspace('dry-run-workspace', {
    tempPrefix: 'um-vertical-dry-',
  });
  const duplicateTopologyId = createWorkspace('dry-run-workspace', {
    tempPrefix: 'um-vertical-dry-',
  });
  const duplicatePort = createWorkspace('dry-run-workspace', {
    tempPrefix: 'um-vertical-dry-',
  });

  try {
    addUltramodernVertical({
      workspaceRoot: duplicateName.workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    const duplicateNameSnapshot = snapshotWorkspace(duplicateName.workspaceDir);
    assert.throws(
      () =>
        planUltramodernVertical({
          workspaceRoot: duplicateName.workspaceDir,
          name: 'catalog',
          modernVersion: '3.2.1',
        }),
      /Refusing to overwrite existing path: verticals\/catalog/,
    );
    assert.deepEqual(
      snapshotWorkspace(duplicateName.workspaceDir),
      duplicateNameSnapshot,
    );

    addSyntheticTopologyVertical(duplicateTopologyId.workspaceDir, {
      id: 'checkout',
      port: 4101,
    });
    const duplicateIdSnapshot = snapshotWorkspace(
      duplicateTopologyId.workspaceDir,
    );
    assert.throws(
      () =>
        planUltramodernVertical({
          workspaceRoot: duplicateTopologyId.workspaceDir,
          name: 'checkout',
          modernVersion: '3.2.1',
        }),
      /Duplicate app id "checkout"/,
    );
    assert.deepEqual(
      snapshotWorkspace(duplicateTopologyId.workspaceDir),
      duplicateIdSnapshot,
    );

    addUltramodernVertical({
      workspaceRoot: duplicatePort.workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    addSyntheticTopologyVertical(duplicatePort.workspaceDir, {
      id: 'inventory',
      port: 4101,
    });
    const duplicatePortSnapshot = snapshotWorkspace(duplicatePort.workspaceDir);
    assert.throws(
      () =>
        planUltramodernVertical({
          workspaceRoot: duplicatePort.workspaceDir,
          name: 'checkout',
          modernVersion: '3.2.1',
        }),
      /Duplicate development port "4101"/,
    );
    assert.deepEqual(
      snapshotWorkspace(duplicatePort.workspaceDir),
      duplicatePortSnapshot,
    );
  } finally {
    fs.rmSync(duplicateName.tempRoot, { recursive: true, force: true });
    fs.rmSync(duplicateTopologyId.tempRoot, { recursive: true, force: true });
    fs.rmSync(duplicatePort.tempRoot, { recursive: true, force: true });
  }
});

test('CLI --dry-run prints a MicroVertical plan without writing files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'um-cli-dry-run-'));

  try {
    const createResult = runCli(tmpDir, ['cli-dry-run-workspace']);
    assert.equal(createResult.status, 0, createResult.stderr);
    const workspaceDir = path.join(tmpDir, 'cli-dry-run-workspace');
    const before = snapshotWorkspace(workspaceDir);

    const dryRunResult = runCli(workspaceDir, [
      'catalog',
      '--vertical',
      '--dry-run',
    ]);
    assert.equal(dryRunResult.status, 0, dryRunResult.stderr);
    const plan = JSON.parse(dryRunResult.stdout);
    assert.equal(plan.dryRun, true);
    assert.equal(plan.selectedPort, 4101);
    assert.equal(plan.moduleFederationRemote.name, 'verticalCatalog');
    assert.equal(plan.apiPrefix, '/catalog-api');
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/catalog')),
      false,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CLI --dry-run is only accepted for MicroVertical additions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'um-cli-dry-run-'));

  try {
    const result = runCli(tmpDir, ['dry-run-workspace', '--dry-run']);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /--dry-run is currently supported only with --vertical/,
    );
    assert.equal(fs.existsSync(path.join(tmpDir, 'dry-run-workspace')), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

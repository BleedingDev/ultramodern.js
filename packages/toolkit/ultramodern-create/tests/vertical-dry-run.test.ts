import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  addUltramodernVertical,
  planUltramodernVertical,
} from '../src/ultramodern-workspace';
import { __transactionTestHooks } from '../src/ultramodern-workspace/add-vertical/transaction';
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

test('workspace snapshots ignore Git maintenance state and retain generated files', () => {
  const { tempRoot, workspaceDir } = createWorkspace('snapshot-workspace', {
    tempPrefix: 'um-generated-snapshot-',
  });

  try {
    const before = snapshotWorkspace(workspaceDir);
    assert.ok(before['.gitignore']);
    assert.ok(before['.modernjs/ultramodern.json']);

    const gitDir = path.join(workspaceDir, '.git');
    fs.mkdirSync(path.join(gitDir, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'logs/HEAD'), 'maintenance state\n');
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
    fs.writeFileSync(path.join(gitDir, 'logs/HEAD'), 'updated state\n');
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
    fs.rmSync(gitDir, { recursive: true });
    fs.writeFileSync(gitDir, 'gitdir: /external/worktree/metadata\n');
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);

    for (const [relativePath, content] of Object.entries(before)) {
      fs.writeFileSync(
        path.join(workspaceDir, relativePath),
        `${content}\nmutation probe\n`,
      );
    }
    const edited = snapshotWorkspace(workspaceDir);
    assert.deepEqual(Object.keys(edited), Object.keys(before));
    for (const [relativePath, content] of Object.entries(before)) {
      assert.equal(
        edited[relativePath],
        `${content}\nmutation probe\n`,
        `snapshot must detect edits to ${relativePath}`,
      );
      fs.writeFileSync(path.join(workspaceDir, relativePath), content);
    }

    const manifestPath = path.join(workspaceDir, 'package.json');
    fs.rmSync(manifestPath);
    assert.notDeepEqual(snapshotWorkspace(workspaceDir), before);
    fs.writeFileSync(manifestPath, before['package.json']);
    const addedPath = path.join(workspaceDir, '.github/snapshot-probe.yml');
    fs.mkdirSync(path.dirname(addedPath), { recursive: true });
    fs.writeFileSync(addedPath, 'name: snapshot probe\n');
    assert.notDeepEqual(snapshotWorkspace(workspaceDir), before);
    fs.rmSync(addedPath);
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
  } finally {
    __transactionTestHooks.beforePublish = undefined;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('public dry-run plan leaves workspace unchanged and matches normal run summary', () => {
  const { tempRoot, workspaceDir } = createWorkspace('dry-run-workspace', {
    tempPrefix: 'um-vertical-dry-',
  });

  try {
    const before = snapshotWorkspace(workspaceDir);
    __transactionTestHooks.beforePublish = () => {
      throw new Error('Preview must not publish');
    };
    const plan = planUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });

    __transactionTestHooks.beforePublish = undefined;
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
    const projected = new Map<string, any>();
    for (const mutation of plan.jsonMutations) {
      if (!projected.has(mutation.path))
        projected.set(
          mutation.path,
          before[mutation.path] ? JSON.parse(before[mutation.path]) : undefined,
        );
      if (mutation.pointer === '') {
        projected.set(mutation.path, mutation.value);
        continue;
      }
      const segments = mutation.pointer
        .slice(1)
        .split('/')
        .map(part => part.replaceAll('~1', '/').replaceAll('~0', '~'));
      const key = segments.pop()!;
      const parent = segments.reduce(
        (value, segment) => value[segment],
        projected.get(mutation.path),
      );
      if (key === '-') parent.push(mutation.value);
      else if (mutation.value === undefined) delete parent[key];
      else parent[key] = mutation.value;
    }
    for (const [relativePath, expected] of projected) {
      assert.deepEqual(
        JSON.parse(
          fs.readFileSync(path.join(workspaceDir, relativePath), 'utf8'),
        ),
        expected,
        `preview must describe the actual published JSON: ${relativePath}`,
      );
    }
    assert.deepEqual(plan.createdApps, result.createdApps);
    assert.deepEqual(plan.createdPaths, result.createdPaths);
    assert.deepEqual(plan.rewrittenPaths, result.rewrittenPaths);
    assert.deepEqual(plan.assignedPorts, result.assignedPorts);
    assert.deepEqual(plan.moduleFederationNames, result.moduleFederationNames);
    assert.deepEqual(plan.apiPrefixes, result.apiPrefixes);
    assert.equal(plan.generatedContractPath, result.generatedContractPath);
  } finally {
    __transactionTestHooks.beforePublish = undefined;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI --dry-run prints a MicroVertical plan without writing files', () => {
  const { tempRoot: tmpDir, workspaceDir } = createWorkspace(
    'cli-dry-run-workspace',
    { tempPrefix: 'um-cli-dry-run-' },
  );

  try {
    const configPath = path.join(
      workspaceDir,
      'apps/shell-super-app/modern.config.ts',
    );
    fs.writeFileSync(
      configPath,
      `// Authored configuration must survive preview.\n${fs.readFileSync(configPath, 'utf8')}`,
    );
    const before = snapshotWorkspace(workspaceDir);

    const dryRunResult = runCli(workspaceDir, [
      'catalog',
      '--vertical',
      '--dry-run',
    ]);
    assert.equal(dryRunResult.status, 0, dryRunResult.stderr);
    assert.match(dryRunResult.stderr, /preserved consumer-owned artifact/);
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

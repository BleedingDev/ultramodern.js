import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';

const packageRoot = path.resolve(__dirname, '..');
const builtCliPath = path.join(packageRoot, 'dist/esm-node/index.js');

const hermeticEnv = {
  ...process.env,
  MODERN_CREATE_ULTRAMODERN_FRAMEWORK_VERSION: '3.2.0-ultramodern.108',
};

function createWorkspace(packageName: string) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-vertical-cli-'));
  const workspaceDir = path.join(tempRoot, packageName);

  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName,
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: {
      strategy: 'install',
      modernPackageVersion: '3.2.0-ultramodern.108',
    },
  });

  return { tempRoot, workspaceDir };
}

function runCli(cwd: string, args: string[]) {
  return spawnSync(process.execPath, [builtCliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: hermeticEnv,
  });
}

function listFiles(root: string, dir = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, entryPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function snapshotWorkspace(workspaceDir: string): Record<string, string> {
  return Object.fromEntries(
    listFiles(workspaceDir).map(relativePath => [
      relativePath,
      fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
    ]),
  );
}

function readJson(workspaceDir: string, relativePath: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceDir, relativePath), 'utf-8'),
  );
}

function assertGeneratedVertical(workspaceDir: string, name: string) {
  assert.equal(
    fs.existsSync(path.join(workspaceDir, `verticals/${name}/package.json`)),
    true,
  );

  const topology = readJson(workspaceDir, 'topology/reference-topology.json');
  assert.ok(topology.shell.verticalRefs.includes(name));
  assert.ok(
    topology.verticals.some(
      (vertical: { id?: string }) => vertical.id === name,
    ),
  );
}

test('CLI MicroVertical flow supports positional and explicit vertical names', () => {
  const cases = [
    {
      workspace: 'vertical-cli-positional',
      args: ['catalog', '--vertical'],
      name: 'catalog',
    },
    {
      workspace: 'vertical-cli-equals',
      args: ['--vertical=checkout'],
      name: 'checkout',
    },
    {
      workspace: 'vertical-cli-name-flag',
      args: ['--vertical-name', 'inventory'],
      name: 'inventory',
    },
    {
      workspace: 'vertical-cli-name-equals',
      args: ['--vertical-name=reports'],
      name: 'reports',
    },
  ];

  for (const testCase of cases) {
    const { tempRoot, workspaceDir } = createWorkspace(testCase.workspace);

    try {
      const result = runCli(workspaceDir, testCase.args);
      assert.equal(result.status, 0, result.stderr);
      assertGeneratedVertical(workspaceDir, testCase.name);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
});

test('CLI MicroVertical flow rejects ambiguous vertical names without writes', () => {
  const { tempRoot, workspaceDir } = createWorkspace('vertical-cli-ambiguous');

  try {
    const before = snapshotWorkspace(workspaceDir);
    const result = runCli(workspaceDir, ['catalog', '--vertical=checkout']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Ambiguous MicroVertical name/);
    assert.match(result.stderr, /catalog/);
    assert.match(result.stderr, /checkout/);
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI MicroVertical flow rejects missing vertical names without writes', () => {
  const { tempRoot, workspaceDir } = createWorkspace('vertical-cli-missing');

  try {
    const before = snapshotWorkspace(workspaceDir);
    const missingPositional = runCli(workspaceDir, ['--vertical']);
    const missingExplicit = runCli(workspaceDir, ['--vertical-name']);

    assert.notEqual(missingPositional.status, 0);
    assert.match(missingPositional.stderr, /Missing MicroVertical name/);
    assert.notEqual(missingExplicit.status, 0);
    assert.match(missingExplicit.stderr, /Missing MicroVertical name/);
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI help documents MicroVertical positional and explicit forms', () => {
  const result = runCli(packageRoot, ['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--vertical\[=<name>\]/);
  assert.match(result.stdout, /--vertical-name <name>/);
  assert.match(result.stdout, /--codesmith-overlay <package-or-path>/);
  assert.match(result.stdout, /catalog --vertical/);
  assert.match(result.stdout, /--vertical=catalog/);
});

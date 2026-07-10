import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
    const { tempRoot, workspaceDir } = createWorkspace(testCase.workspace, {
      tempPrefix: 'um-vertical-cli-',
    });

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

test('CLI MicroVertical flow rejects bridge options without writes', () => {
  const { tempRoot, workspaceDir } = createWorkspace('vertical-cli-bridge');

  try {
    const before = snapshotWorkspace(workspaceDir);
    const result = runCli(workspaceDir, [
      '--vertical=catalog',
      '--bridge-parent-root=..',
    ]);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Bridge options are supported only when creating a new UltraModern workspace/,
    );
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI help documents bridge mode options', () => {
  const result = runCli(packageRoot, ['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--bridge Enable explicit/);
  assert.match(result.stdout, /--bridge-parent-root <path>/);
  assert.match(result.stdout, /--bridge-workspace-package <glob>/);
  assert.match(result.stdout, /--bridge-workspace-package-name <glob=package/);
  assert.match(result.stdout, /--bridge-test-alias <glob:alias=target>/);
  assert.match(result.stdout, /--bridge-dependency <package/);
  assert.match(result.stdout, /--bridge-lockfile-policy <nested\|parent>/);
  assert.match(result.stdout, /--bridge-gate <name=command>/);
  assert.match(result.stdout, /--bridge-gate-cwd <name=cwd>/);
  assert.match(result.stdout, /--bridge-react-singleton <package/);
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

test('CLI help documents preset, api-protocol and horizontal-remote flags', () => {
  const result = runCli(packageRoot, ['--help']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--preset=<full-stack\|api-only\|ui-only>/);
  assert.match(result.stdout, /--api-protocol=<rest\|rpc>/);
  assert.match(result.stdout, /--horizontal-remote/);
});

test('CLI --preset=api-only generates a headless MicroVertical', () => {
  const { tempRoot, workspaceDir } = createWorkspace('vertical-cli-api-only', {
    tempPrefix: 'um-vertical-cli-',
  });

  try {
    const result = runCli(workspaceDir, [
      'catalog',
      '--vertical',
      '--preset=api-only',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.existsSync(path.join(workspaceDir, 'verticals/catalog/api/index.ts')),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, 'verticals/catalog/src/routes/layout.tsx'),
      ),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI --horizontal-remote generates a components-only unit', () => {
  const { tempRoot, workspaceDir } = createWorkspace(
    'vertical-cli-horizontal',
    {
      tempPrefix: 'um-vertical-cli-',
    },
  );

  try {
    const result = runCli(workspaceDir, [
      'design-system',
      '--vertical',
      '--horizontal-remote',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      fs.existsSync(
        path.join(
          workspaceDir,
          'verticals/design-system/src/federation-entry.tsx',
        ),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(workspaceDir, 'verticals/design-system/api/index.ts'),
      ),
      false,
    );
    const topology = readJson(workspaceDir, 'topology/reference-topology.json');
    const entry = topology.verticals.find(
      (vertical: { id?: string }) => vertical.id === 'design-system',
    );
    assert.equal(entry.deliveryUnitKind, 'horizontal-remote');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI rejects an unsupported --preset without writing files', () => {
  const { tempRoot, workspaceDir } = createWorkspace(
    'vertical-cli-bad-preset',
    {
      tempPrefix: 'um-vertical-cli-',
    },
  );

  try {
    const before = snapshotWorkspace(workspaceDir);
    const result = runCli(workspaceDir, [
      'catalog',
      '--vertical',
      '--preset=bogus',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported --preset "bogus"/);
    assert.deepEqual(snapshotWorkspace(workspaceDir), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

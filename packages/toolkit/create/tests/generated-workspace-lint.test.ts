import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { createWorkspace } from './helpers/workspace-kit';

interface OxlintReport {
  diagnostics: unknown[];
}

const packageRoot = path.resolve(__dirname, '..');
const lintDependencyNodeModules = path.dirname(
  fs.realpathSync(path.join(packageRoot, 'node_modules/ultracite')),
);

function provisionGeneratedLintDependencies(workspaceDir: string) {
  const nodeModulesDir = path.join(workspaceDir, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  for (const packageName of ['oxlint', 'ultracite']) {
    fs.symlinkSync(
      path.join(lintDependencyNodeModules, packageName),
      path.join(nodeModulesDir, packageName),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
  fs.symlinkSync(
    fs.realpathSync(path.join(packageRoot, 'node_modules/typescript')),
    path.join(nodeModulesDir, 'typescript'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
}

function parseOxlintReport(
  stdout: string,
  commandOutput: string,
): OxlintReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    assert.fail(
      `Oxlint did not return JSON: ${String(error)}\n${commandOutput}`,
    );
  }

  assert.ok(
    parsed !== null && typeof parsed === 'object',
    `Oxlint returned an invalid report.\n${commandOutput}`,
  );
  const diagnostics = Reflect.get(parsed, 'diagnostics');
  assert.ok(
    Array.isArray(diagnostics),
    `Oxlint report omitted diagnostics.\n${commandOutput}`,
  );
  return { diagnostics };
}

function assertGeneratedWorkspaceLintClean(
  workspaceDir: string,
  generatedState: string,
) {
  const result = spawnSync(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--config.verify-deps-before-run=false', 'lint', '--format', 'json'],
    {
      cwd: workspaceDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${path.join(packageRoot, 'node_modules/.bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    },
  );
  const commandOutput = `${result.stdout}\n${result.stderr}`;
  assert.equal(
    result.error,
    undefined,
    `${generatedState} lint failed to execute.\n${commandOutput}`,
  );
  const report = parseOxlintReport(result.stdout, commandOutput);
  assert.deepEqual(
    report.diagnostics,
    [],
    `${generatedState} produced lint diagnostics.\n${commandOutput}`,
  );
  assert.equal(
    result.status,
    0,
    `${generatedState} lint exited unsuccessfully.\n${commandOutput}`,
  );
}

function assertGeneratedWorkspaceContractClean(
  workspaceDir: string,
  generatedState: string,
) {
  const result = spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    { cwd: workspaceDir, encoding: 'utf8' },
  );
  assert.equal(
    result.status,
    0,
    `${generatedState} failed its generated workspace contract.\n${result.stdout}\n${result.stderr}`,
  );
}

test('generated shell, checkout, and generic verticals are lint-clean', () => {
  const { tempRoot, workspaceDir } = createWorkspace('generated-lint', {
    tempPrefix: 'um-generated-lint-',
  });

  try {
    provisionGeneratedLintDependencies(workspaceDir);
    assertGeneratedWorkspaceLintClean(workspaceDir, 'shell-only workspace');
    assertGeneratedWorkspaceContractClean(workspaceDir, 'shell-only workspace');

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'checkout',
      modernVersion: '3.2.1',
    });
    assertGeneratedWorkspaceLintClean(workspaceDir, 'workspace with checkout');
    assertGeneratedWorkspaceContractClean(
      workspaceDir,
      'workspace with checkout',
    );

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'catalog',
      modernVersion: '3.2.1',
    });
    assertGeneratedWorkspaceLintClean(
      workspaceDir,
      'workspace with checkout and catalog',
    );
    assertGeneratedWorkspaceContractClean(
      workspaceDir,
      'workspace with checkout and catalog',
    );

    for (const name of ['records', 'actions', 'workspace']) {
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name,
        modernVersion: '3.2.1',
      });
    }
    assertGeneratedWorkspaceLintClean(
      workspaceDir,
      'workspace with former demo-name verticals',
    );
    assertGeneratedWorkspaceContractClean(
      workspaceDir,
      'workspace with former demo-name verticals',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated lint policy accepts the workspace component styles', () => {
  const { tempRoot, workspaceDir } = createWorkspace(
    'generated-component-style',
    {
      tempPrefix: 'um-generated-component-style-',
    },
  );

  try {
    provisionGeneratedLintDependencies(workspaceDir);
    const componentDir = path.join(workspaceDir, 'packages', 'style-probe');
    fs.mkdirSync(componentDir, { recursive: true });
    fs.writeFileSync(
      path.join(componentDir, 'components.tsx'),
      `export function FunctionDeclaration() {
  return <div />;
}

export const ArrowFunction = () => <div />;
`,
      'utf-8',
    );

    assertGeneratedWorkspaceLintClean(
      workspaceDir,
      'workspace component style probe',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

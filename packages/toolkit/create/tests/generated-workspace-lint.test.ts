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
const oxlintCliPath = path.join(lintDependencyNodeModules, 'oxlint/bin/oxlint');

function createLintHarness(tempRoot: string) {
  const lintHarnessDir = path.join(tempRoot, 'lint-harness');
  fs.mkdirSync(lintHarnessDir, { recursive: true });
  fs.symlinkSync(
    lintDependencyNodeModules,
    path.join(lintHarnessDir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return lintHarnessDir;
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
  lintHarnessDir: string,
  generatedState: string,
) {
  const rootPackage: unknown = JSON.parse(
    fs.readFileSync(path.join(workspaceDir, 'package.json'), 'utf-8'),
  );
  assert.ok(rootPackage !== null && typeof rootPackage === 'object');
  const scripts = Reflect.get(rootPackage, 'scripts');
  assert.ok(scripts !== null && typeof scripts === 'object');
  assert.equal(
    Reflect.get(scripts, 'lint'),
    'oxlint apps verticals packages',
    'the regression must exercise the generated pnpm lint surface',
  );

  const lintConfigPath = path.join(lintHarnessDir, 'oxlint.config.ts');
  fs.copyFileSync(path.join(workspaceDir, 'oxlint.config.ts'), lintConfigPath);
  const result = spawnSync(
    process.execPath,
    [
      oxlintCliPath,
      '--config',
      lintConfigPath,
      '--format',
      'json',
      'apps',
      'verticals',
      'packages',
    ],
    {
      cwd: workspaceDir,
      encoding: 'utf-8',
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
    const lintHarnessDir = createLintHarness(tempRoot);
    assertGeneratedWorkspaceLintClean(
      workspaceDir,
      lintHarnessDir,
      'shell-only workspace',
    );
    assertGeneratedWorkspaceContractClean(workspaceDir, 'shell-only workspace');

    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'checkout',
      modernVersion: '3.2.1',
    });
    assertGeneratedWorkspaceLintClean(
      workspaceDir,
      lintHarnessDir,
      'workspace with checkout',
    );
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
      lintHarnessDir,
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
      lintHarnessDir,
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

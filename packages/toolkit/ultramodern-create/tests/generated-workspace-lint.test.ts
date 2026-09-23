import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import execa from '@modern-js/utils/execa';

import { addUltramodernVertical } from '../src/ultramodern-workspace';
import { formatGeneratedWorkspaceFiles } from '../src/ultramodern-workspace/fs-io';
import { createWorkspace } from './helpers/workspace-kit';

interface OxlintReport {
  diagnostics: unknown[];
}

const packageRoot = path.resolve(__dirname, '..');
const lintDependencyNodeModules = path.dirname(
  fs.realpathSync(path.join(packageRoot, 'node_modules/ultracite')),
);

function provisionPackageBinary(
  nodeModulesDir: string,
  packageName: string,
  binaryName: string,
) {
  const packageJson = JSON.parse(
    fs.readFileSync(
      path.join(nodeModulesDir, packageName, 'package.json'),
      'utf8',
    ),
  ) as { bin?: Record<string, string> | string };
  const packageBinary =
    typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.[binaryName];
  assert.ok(packageBinary, `${packageName} must expose ${binaryName}`);

  const binDir = path.join(nodeModulesDir, '.bin');
  const binaryPath = path.join(nodeModulesDir, packageName, packageBinary);
  fs.mkdirSync(binDir, { recursive: true });
  if (process.platform === 'win32') {
    fs.writeFileSync(
      path.join(binDir, `${binaryName}.cmd`),
      `@echo off\r\n"${process.execPath}" "${binaryPath}" %*\r\n`,
      'utf8',
    );
  } else {
    fs.symlinkSync(
      path.relative(binDir, binaryPath),
      path.join(binDir, binaryName),
      'file',
    );
  }
}

function provisionGeneratedLintDependencies(workspaceDir: string) {
  const nodeModulesDir = path.join(workspaceDir, 'node_modules');
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  for (const packageName of ['oxfmt', 'oxlint', 'ultracite']) {
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
  provisionPackageBinary(nodeModulesDir, 'oxlint', 'oxlint');
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

function provisionApiDependencies(workspaceDir: string, scope: string) {
  const dependencyRequire = createRequire(
    path.join(lintDependencyNodeModules, 'ultracite/package.json'),
  );
  for (const [name, target] of [
    ['effect', path.dirname(dependencyRequire.resolve('effect/package.json'))],
    [
      '@typescript/native',
      fs.realpathSync(path.join(packageRoot, 'node_modules/typescript')),
    ],
    ['@modern-js/code-tools', path.resolve(packageRoot, '../code-tools')],
    [
      '@modern-js/bff-effect',
      path.resolve(packageRoot, '../../server/bff-effect'),
    ],
    [
      `@${scope}/shared-contracts`,
      path.join(workspaceDir, 'packages/shared-contracts'),
    ],
  ]) {
    const destination = path.join(workspaceDir, 'node_modules', name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(
      target,
      destination,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
}

function assertGeneratedWorkspaceLintClean(
  workspaceDir: string,
  generatedState: string,
) {
  const externalPath = (process.env.PATH ?? process.env.Path ?? '')
    .split(path.delimiter)
    .filter(entry => !/[\\/]node_modules[\\/]\.bin$/u.test(entry))
    .join(path.delimiter);
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: externalPath };
  if (process.platform === 'win32') {
    env.Path = externalPath;
  }
  const result = execa.sync(
    'pnpm',
    ['--config.verify-deps-before-run=false', 'lint', '--format', 'json'],
    {
      cwd: workspaceDir,
      encoding: 'utf-8',
      env,
      reject: false,
    },
  );
  const commandOutput = `${result.stdout}\n${result.stderr}`;
  assert.equal(
    result.failed,
    false,
    `${generatedState} lint failed to execute.\n${commandOutput}`,
  );
  const report = parseOxlintReport(result.stdout, commandOutput);
  assert.deepEqual(
    report.diagnostics,
    [],
    `${generatedState} produced lint diagnostics.\n${commandOutput}`,
  );
  assert.equal(
    result.exitCode,
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
    [path.resolve(__dirname, '../bin/run.js'), 'ultramodern', 'validate'],
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
    // One named and one generic vertical exercise the distinct generated
    // branches; the complete template does not need five more lint passes.
    addUltramodernVertical({
      workspaceRoot: workspaceDir,
      name: 'records',
      modernVersion: '3.2.1',
    });
    assertGeneratedWorkspaceLintClean(
      workspaceDir,
      'workspace with checkout, catalog, and records',
    );
    assertGeneratedWorkspaceContractClean(
      workspaceDir,
      'workspace with checkout, catalog, and records',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated APIs pass real Oxlint after Oxfmt with the current preset and native boundaries', () => {
  const { tempRoot, workspaceDir } = createWorkspace('erp-api-lint');
  try {
    provisionGeneratedLintDependencies(workspaceDir);
    provisionApiDependencies(workspaceDir, 'erp-api-lint');
    const names = ['inventory', 'orders'];
    for (const name of names) {
      addUltramodernVertical({
        workspaceRoot: workspaceDir,
        name,
        modernVersion: '3.9.0',
      });
    }
    formatGeneratedWorkspaceFiles(workspaceDir);
    assertGeneratedWorkspaceLintClean(
      workspaceDir,
      'two formatted scoped APIs',
    );
    const checked = spawnSync(
      process.execPath,
      [path.resolve(packageRoot, '../code-tools/bin/modern-api-check.mjs')],
      {
        cwd: workspaceDir,
        encoding: 'utf8',
        env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: workspaceDir },
      },
    );
    assert.equal(checked.status, 0, `${checked.stdout}\n${checked.stderr}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

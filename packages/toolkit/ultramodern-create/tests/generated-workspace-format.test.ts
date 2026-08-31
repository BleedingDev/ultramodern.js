import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { formatGeneratedWorkspaceFiles } from '../src/ultramodern-workspace/fs-io';
import { createWorkspace } from './helpers/workspace-kit';

const packageRoot = path.resolve(__dirname, '..');
const formatDependencyNodeModules = path.dirname(
  fs.realpathSync(path.join(packageRoot, 'node_modules/ultracite')),
);
const oxfmtCliPath = path.join(formatDependencyNodeModules, 'oxfmt/bin/oxfmt');

function createFormatHarness(tempRoot: string, workspaceDir: string) {
  const formatHarnessDir = path.join(tempRoot, 'format-harness');
  fs.mkdirSync(formatHarnessDir, { recursive: true });
  fs.symlinkSync(
    formatDependencyNodeModules,
    path.join(formatHarnessDir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const configPath = path.join(formatHarnessDir, 'oxfmt.config.ts');
  fs.copyFileSync(path.join(workspaceDir, 'oxfmt.config.ts'), configPath);
  return configPath;
}

function runGeneratedFormat(
  workspaceDir: string,
  configPath: string,
  relativePath: string,
  check: boolean,
) {
  return spawnSync(
    process.execPath,
    [
      oxfmtCliPath,
      '--config',
      configPath,
      ...(check ? ['--check'] : []),
      relativePath,
    ],
    {
      cwd: workspaceDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    },
  );
}

function assertFormatStatus(
  result: ReturnType<typeof runGeneratedFormat>,
  expectedStatus: number,
  state: string,
) {
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(
    result.error,
    undefined,
    `${state} failed to execute.\n${output}`,
  );
  assert.equal(result.status, expectedStatus, `${state} failed.\n${output}`);
}

test('generated formatter composes Ultracite during preformat and workspace checks', () => {
  const { tempRoot, workspaceDir } = createWorkspace('generated-format', {
    tempPrefix: 'um-generated-format-',
  });
  const configPath = createFormatHarness(tempRoot, workspaceDir);
  const relativePath = path.join('packages', 'format-probe.tsx');
  const probePath = path.join(workspaceDir, relativePath);
  const unsortedProbe =
    'export const Probe = () => <div className="p-4 flex items-center">probe</div>;\n';

  try {
    fs.writeFileSync(probePath, unsortedProbe, 'utf-8');
    assertFormatStatus(
      runGeneratedFormat(workspaceDir, configPath, relativePath, true),
      1,
      'generated formatter policy probe',
    );
    assertFormatStatus(
      runGeneratedFormat(workspaceDir, configPath, relativePath, false),
      0,
      'generated formatter write',
    );
    assertFormatStatus(
      runGeneratedFormat(workspaceDir, configPath, relativePath, true),
      0,
      'generated formatter idempotence check',
    );

    fs.writeFileSync(probePath, unsortedProbe, 'utf-8');
    formatGeneratedWorkspaceFiles(workspaceDir, [relativePath]);
    assertFormatStatus(
      runGeneratedFormat(workspaceDir, configPath, relativePath, true),
      0,
      'generation preformat compatibility check',
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

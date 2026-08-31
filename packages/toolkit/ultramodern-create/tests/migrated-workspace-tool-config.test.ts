import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runUltramodernToolingCli } from '../src/ultramodern-tooling/commands';
import { createWorkspace } from './helpers/workspace-kit';

interface OxlintReport {
  diagnostics: unknown[];
}

const packageRoot = path.resolve(__dirname, '..');
const toolDependencyNodeModules = path.dirname(
  fs.realpathSync(path.join(packageRoot, 'node_modules/ultracite')),
);
const oxfmtCliPath = path.join(toolDependencyNodeModules, 'oxfmt/bin/oxfmt');
const oxlintCliPath = path.join(toolDependencyNodeModules, 'oxlint/bin/oxlint');

function runTool(cliPath: string, args: string[], workspaceRoot: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  });
}

function toolOutput(result: ReturnType<typeof runTool>) {
  return `${result.stdout}\n${result.stderr}`;
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
  assert.ok(parsed !== null && typeof parsed === 'object');
  const diagnostics = Reflect.get(parsed, 'diagnostics');
  assert.ok(Array.isArray(diagnostics), commandOutput);
  return { diagnostics };
}

test('migration restores executable Ultracite format and component-style policies', async () => {
  const { tempRoot, workspaceDir: workspaceRoot } = createWorkspace(
    'migrated-tool-config',
    { tempPrefix: 'um-migrated-tool-config-' },
  );
  fs.symlinkSync(
    toolDependencyNodeModules,
    path.join(workspaceRoot, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  fs.writeFileSync(
    path.join(workspaceRoot, 'oxfmt.config.ts'),
    `import { defineConfig } from 'oxfmt';
import ultracite from 'ultracite/oxfmt';

export default defineConfig({
  extends: [ultracite],
  ignorePatterns: [],
});
`,
  );
  fs.writeFileSync(
    path.join(workspaceRoot, 'oxlint.config.ts'),
    `import core from 'ultracite/oxlint/core';
import react from 'ultracite/oxlint/react';

export default {
  extends: [core, react],
};
`,
  );

  const relativeFormatProbe = path.join('packages', 'format-probe.tsx');
  fs.writeFileSync(
    path.join(workspaceRoot, relativeFormatProbe),
    'export const Probe = () => <div className="p-4 flex items-center">probe</div>;\n',
  );
  const relativeLintProbe = path.join('packages', 'component-probe.tsx');
  fs.writeFileSync(
    path.join(workspaceRoot, relativeLintProbe),
    `export function FunctionComponent() {
  return <div />;
}

export const ArrowComponent = () => <div />;
`,
  );

  try {
    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );

    const initialFormatCheck = runTool(
      oxfmtCliPath,
      ['--config', 'oxfmt.config.ts', '--check', relativeFormatProbe],
      workspaceRoot,
    );
    assert.equal(
      initialFormatCheck.status,
      1,
      `migrated formatter did not apply the Ultracite policy.\n${toolOutput(initialFormatCheck)}`,
    );
    const format = runTool(
      oxfmtCliPath,
      ['--config', 'oxfmt.config.ts', relativeFormatProbe],
      workspaceRoot,
    );
    assert.equal(format.status, 0, toolOutput(format));
    const finalFormatCheck = runTool(
      oxfmtCliPath,
      ['--config', 'oxfmt.config.ts', '--check', relativeFormatProbe],
      workspaceRoot,
    );
    assert.equal(finalFormatCheck.status, 0, toolOutput(finalFormatCheck));

    const lint = runTool(
      oxlintCliPath,
      ['--config', 'oxlint.config.ts', '--format', 'json', relativeLintProbe],
      workspaceRoot,
    );
    const lintOutput = toolOutput(lint);
    assert.equal(lint.error, undefined, lintOutput);
    assert.deepEqual(
      parseOxlintReport(lint.stdout, lintOutput).diagnostics,
      [],
      lintOutput,
    );
    assert.equal(lint.status, 0, lintOutput);

    assert.equal(
      await runUltramodernToolingCli(
        ['migrate-strict-effect', '--skip-install'],
        workspaceRoot,
      ),
      0,
    );
  } finally {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  }
});

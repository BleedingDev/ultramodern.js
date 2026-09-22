import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernShell,
  generateUltramodernWorkspace,
} from '../src/ultramodern-workspace';

function generateWorkspace(workspaceDir: string) {
  generateUltramodernWorkspace({
    targetDir: workspaceDir,
    packageName: path.basename(workspaceDir),
    modernVersion: '3.2.1',
    enableTailwind: true,
    packageSource: { strategy: 'workspace' },
  });
}

function runValidation(workspaceDir: string) {
  const typescriptPackage = createRequire(import.meta.url).resolve(
    'typescript/package.json',
  );
  const compilerPath = path.join(
    workspaceDir,
    'node_modules/@typescript/native',
  );
  if (!fs.existsSync(compilerPath)) {
    fs.mkdirSync(path.dirname(compilerPath), { recursive: true });
    fs.symlinkSync(
      path.dirname(typescriptPackage),
      compilerPath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    {
      cwd: workspaceDir,
      encoding: 'utf-8',
    },
  );
}

function commandOutput(result: ReturnType<typeof runValidation>) {
  return `${result.stdout}\n${result.stderr}`;
}

function appendText(workspaceDir: string, relativePath: string, text: string) {
  fs.appendFileSync(path.join(workspaceDir, relativePath), text, 'utf-8');
}

test('generated validator enforces the structural thin-shell gate', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-thin-shell-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const scenarios: Array<{
    name: string;
    mutate: (workspaceDir: string) => void;
    expected: RegExp;
  }> = [
    {
      name: 'shell-api-surface',
      mutate: workspaceDir => {
        fs.mkdirSync(path.join(workspaceDir, 'apps/shell-admin/api'), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(workspaceDir, 'apps/shell-admin/api/index.ts'),
          'export const handler = () => {};\n',
        );
      },
      expected: /structural thin-shell shell-api-surface/,
    },
    {
      name: 'shell-server-surface',
      mutate: workspaceDir => {
        fs.mkdirSync(path.join(workspaceDir, 'apps/shell-admin/server'), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(workspaceDir, 'apps/shell-admin/server/index.ts'),
          'export const server = () => {};\n',
        );
      },
      expected: /structural thin-shell shell-server-surface/,
    },
    {
      name: 'shell-backend-federation',
      mutate: workspaceDir => {
        fs.writeFileSync(
          path.join(
            workspaceDir,
            'apps/shell-super-app/backend-federation.config.ts',
          ),
          'export default {};\n',
        );
      },
      expected: /structural thin-shell shell-backend-federation/,
    },
    {
      name: 'vertical-directory-deep-import',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/src/routes/shell-frame.tsx',
          "\nimport { internal } from '../../../verticals/catalog/src/internal';\n",
        );
      },
      expected: /structural thin-shell vertical-directory-deep-import/,
    },
    {
      name: 'workspace-package-source-import',
      mutate: workspaceDir => {
        appendText(
          workspaceDir,
          'apps/shell-super-app/src/routes/shell-frame.tsx',
          "\nimport { raw } from '@baseline/catalog/src/private';\n",
        );
      },
      expected: /structural thin-shell workspace-package-source-import/,
    },
  ];

  try {
    generateWorkspace(baselineDir);
    addUltramodernShell({
      workspaceRoot: baselineDir,
      name: 'admin',
      modernVersion: '3.2.1',
    });
    // Type-only contracts do not import another package's render implementation.
    appendText(
      baselineDir,
      'apps/shell-super-app/src/routes/shell-frame.tsx',
      "\nimport type { Contract } from '@baseline/catalog/src/contracts';\n",
    );
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    for (const scenario of scenarios) {
      const workspaceDir = path.join(tempRoot, scenario.name);
      fs.cpSync(baselineDir, workspaceDir, { recursive: true });
      scenario.mutate(workspaceDir);

      const result = runValidation(workspaceDir);
      const output = commandOutput(result);
      assert.notEqual(result.status, 0, `${scenario.name}\n${output}`);
      assert.match(output, scenario.expected, scenario.name);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  addUltramodernVertical,
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

function generateWorkspaceWithVertical(workspaceDir: string) {
  generateWorkspace(workspaceDir);
  addUltramodernVertical({
    workspaceRoot: workspaceDir,
    name: 'catalog',
    modernVersion: '3.2.1',
  });
}

function runValidation(workspaceDir: string) {
  const typescriptPackage = createRequire(import.meta.url).resolve(
    'typescript/package.json',
  );
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    {
      cwd: workspaceDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        NODE_PATH: path.dirname(path.dirname(typescriptPackage)),
      },
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
        fs.mkdirSync(path.join(workspaceDir, 'apps/shell-super-app/api'), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(workspaceDir, 'apps/shell-super-app/api/index.ts'),
          'export const handler = () => {};\n',
        );
      },
      expected: /structural thin-shell shell-api-surface/,
    },
    {
      name: 'shell-server-surface',
      mutate: workspaceDir => {
        fs.mkdirSync(path.join(workspaceDir, 'apps/shell-super-app/server'), {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(workspaceDir, 'apps/shell-super-app/server/index.ts'),
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

test('compiler evidence rejects invalid runtime composition while allowing type contracts', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-mf-source-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const shellFile = 'apps/shell-super-app/src/routes/vertical-components.tsx';
  const scenarios = [
    {
      name: 'remote-runtime-package-import',
      source:
        "\nimport CatalogServer from '@baseline/catalog/Widget';\nvoid CatalogServer;\n",
      expected: /federated composition remote-runtime-package-import/u,
    },
    {
      name: 'hydrated-remote-factory',
      source: '\nconst createHydratedRemote = () => undefined;\n',
      expected: /federated composition hydrated-remote-factory/u,
    },
    {
      name: 'hydration-flag',
      source:
        '\nconst HydrationSwap = () => { const [hydrated, setHydrated] = useState(false); useEffect(() => setHydrated(true), []); return hydrated; };\n',
      expected: /federated composition hydration-flag/u,
    },
    {
      name: 'local-loading-copy',
      source:
        '\nconst copy = { loading: <ServerComponent />, fallback: <LocalComponent /> };\nvoid copy;\n',
      expected: /federated composition local-loading-copy/u,
    },
  ] as const;

  try {
    generateWorkspaceWithVertical(baselineDir);
    appendText(
      baselineDir,
      shellFile,
      "\nimport type { WidgetProps } from '@baseline/catalog/Widget';\nexport type { WidgetProps };\n",
    );
    const baseline = runValidation(baselineDir);
    assert.equal(
      baseline.status,
      0,
      `type-only remote contracts must remain valid\n${commandOutput(baseline)}`,
    );

    for (const scenario of scenarios) {
      const workspaceDir = path.join(tempRoot, scenario.name);
      fs.cpSync(baselineDir, workspaceDir, { recursive: true });
      appendText(workspaceDir, shellFile, scenario.source);
      const result = runValidation(workspaceDir);
      const output = commandOutput(result);
      assert.notEqual(result.status, 0, `${scenario.name}\n${output}`);
      assert.match(output, scenario.expected, scenario.name);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

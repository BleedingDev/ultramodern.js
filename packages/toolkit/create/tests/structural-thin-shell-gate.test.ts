import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateUltramodernWorkspace } from '../src/ultramodern-workspace';

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
  return spawnSync(
    process.execPath,
    ['scripts/validate-ultramodern-workspace.mts'],
    { cwd: workspaceDir, encoding: 'utf-8' },
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

test('generated validator is regex- and interpolation-aware when stripping comments', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-thin-shell-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const shellFile = 'apps/shell-super-app/src/routes/regex-cases.tsx';

  // Sources the gate must NOT flag: the forbidden specifier only appears inside
  // a comment, but a preceding regex literal (whose body contains quotes) or a
  // `${ … }` interpolation previously derailed the comment stripper.
  const benignSources = [
    {
      // A regex literal containing quotes must not open a phantom string that
      // swallows the following line comment (leaving its specifier scannable).
      name: 'regex-with-quote-then-comment',
      source:
        "const q = /['\"]/;\n// import x from '../../../verticals/catalog/src/lazy';\nexport const a = 1;\n",
    },
    {
      // A comment inside an interpolation is code and must be stripped.
      name: 'interpolation-comment',
      source:
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source fixture, not a JS template
        "export const t = `${ /* import '../../../verticals/catalog/src/register' */ 1 }`;\n",
    },
    {
      // Nested `${ … }` interpolations must be tracked so an inner comment is
      // still stripped.
      name: 'nested-interpolation-comment',
      source:
        // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source fixture, not a JS template
        "export const t = `o${ `i${ 1 /* import '../../../verticals/catalog/src/private' */ }e` }d`;\n",
    },
  ] as const;

  // Sources the gate MUST still flag: a real forbidden import that follows a
  // regex literal on the same line must be exposed, not hidden by the regex.
  const violatingSources = [
    {
      name: 'forbidden-import-after-regex',
      source:
        "const re = /['\"]/;\nvoid import('../../../verticals/catalog/src/lazy');\n",
      expected: /vertical-directory-dynamic-import/,
    },
  ] as const;

  try {
    generateWorkspace(baselineDir);
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    for (const scenario of benignSources) {
      const workspaceDir = path.join(tempRoot, `benign-${scenario.name}`);
      fs.cpSync(baselineDir, workspaceDir, { recursive: true });
      fs.writeFileSync(
        path.join(workspaceDir, shellFile),
        scenario.source,
        'utf-8',
      );
      const result = runValidation(workspaceDir);
      assert.equal(
        result.status,
        0,
        `${scenario.name}\n${commandOutput(result)}`,
      );
    }

    for (const scenario of violatingSources) {
      const workspaceDir = path.join(tempRoot, `violation-${scenario.name}`);
      fs.cpSync(baselineDir, workspaceDir, { recursive: true });
      fs.writeFileSync(
        path.join(workspaceDir, shellFile),
        scenario.source,
        'utf-8',
      );
      const result = runValidation(workspaceDir);
      const output = commandOutput(result);
      assert.notEqual(result.status, 0, `${scenario.name}\n${output}`);
      assert.match(output, scenario.expected, scenario.name);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator scans every JavaScript/TypeScript extension and import form', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-thin-shell-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const importForms = [
    {
      name: 'static-from',
      source:
        "import { internal } from '../../../verticals/catalog/src/internal';\n",
      expected: /vertical-directory-deep-import/,
    },
    {
      name: 'side-effect',
      source: "import '../../../verticals/catalog/src/register';\n",
      expected: /vertical-directory-side-effect-import/,
    },
    {
      name: 'dynamic',
      source: "void import('../../../verticals/catalog/src/lazy');\n",
      expected: /vertical-directory-dynamic-import/,
    },
    {
      name: 'require',
      source:
        "const internal = require('../../../verticals/catalog/src/runtime');\n",
      expected: /vertical-directory-require/,
    },
  ] as const;
  const extensions = [
    'ts',
    'tsx',
    'mts',
    'cts',
    'js',
    'jsx',
    'mjs',
    'cjs',
  ] as const;

  try {
    generateWorkspace(baselineDir);
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    let scenarioIndex = 0;
    for (const extension of extensions) {
      for (const importForm of importForms) {
        const workspaceDir = path.join(
          tempRoot,
          `${scenarioIndex}-${importForm.name}-${extension}`,
        );
        scenarioIndex += 1;
        fs.cpSync(baselineDir, workspaceDir, { recursive: true });
        const sourcePath = path.join(
          workspaceDir,
          `apps/shell-super-app/src/routes/thin-shell-${importForm.name}.${extension}`,
        );
        fs.writeFileSync(sourcePath, importForm.source, 'utf-8');

        const result = runValidation(workspaceDir);
        const output = commandOutput(result);
        assert.notEqual(
          result.status,
          0,
          `${importForm.name}/${extension}\n${output}`,
        );
        assert.match(output, importForm.expected, importForm.name);
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('generated validator strips comments before scanning thin-shell imports', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'um-thin-shell-'));
  const baselineDir = path.join(tempRoot, 'baseline');
  const shellFile = 'apps/shell-super-app/src/routes/comment-cases.tsx';

  // Sources the gate must NOT flag: the forbidden specifier only ever appears
  // inside a comment or a string literal, never in an executable import.
  const benignSources = [
    {
      name: 'line-comment-import',
      source:
        "// import x from '../../../verticals/catalog/src/lazy';\nexport const a = 1;\n",
    },
    {
      name: 'block-comment-import',
      source:
        "/* import '../../../verticals/catalog/src/register'; */\nexport const b = 2;\n",
    },
    {
      name: 'string-with-double-slash',
      source:
        "export const url = 'http://example.com/verticals/catalog/src/lazy';\n",
    },
  ] as const;

  // Sources the gate MUST flag: a real import that merely carries a magic
  // comment. Stripping the comment must still expose the forbidden specifier.
  const violatingSources = [
    {
      name: 'dynamic-magic-comment',
      source:
        "void import(/* webpackChunkName: 'catalog' */ '../../../verticals/catalog/src/lazy');\n",
      expected: /vertical-directory-dynamic-import/,
    },
    {
      name: 'static-with-block-comment',
      source:
        "import /* keep */ { internal } from '../../../verticals/catalog/src/internal';\n",
      expected: /vertical-directory-deep-import/,
    },
  ] as const;

  try {
    generateWorkspace(baselineDir);
    const baseline = runValidation(baselineDir);
    assert.equal(baseline.status, 0, commandOutput(baseline));

    for (const scenario of benignSources) {
      const workspaceDir = path.join(tempRoot, `benign-${scenario.name}`);
      fs.cpSync(baselineDir, workspaceDir, { recursive: true });
      fs.writeFileSync(
        path.join(workspaceDir, shellFile),
        scenario.source,
        'utf-8',
      );
      const result = runValidation(workspaceDir);
      assert.equal(
        result.status,
        0,
        `${scenario.name}\n${commandOutput(result)}`,
      );
    }

    for (const scenario of violatingSources) {
      const workspaceDir = path.join(tempRoot, `violation-${scenario.name}`);
      fs.cpSync(baselineDir, workspaceDir, { recursive: true });
      fs.writeFileSync(
        path.join(workspaceDir, shellFile),
        scenario.source,
        'utf-8',
      );
      const result = runValidation(workspaceDir);
      const output = commandOutput(result);
      assert.notEqual(result.status, 0, `${scenario.name}\n${output}`);
      assert.match(output, scenario.expected, scenario.name);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

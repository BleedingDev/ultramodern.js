import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  collectStaticSpecifiers,
  findUnloadableImports,
  listTrackedFiles,
} from '../static-import-closure.mjs';
import { validateWorkflowContent } from '../validate-github-workflows.mjs';

const withRepository = (t, files, untracked = {}) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-closure-'));
  t.after(() => fs.rmSync(rootDir, { force: true, recursive: true }));
  const write = entries => {
    for (const [file, content] of Object.entries(entries)) {
      fs.mkdirSync(path.dirname(path.join(rootDir, file)), { recursive: true });
      fs.writeFileSync(path.join(rootDir, file), content);
    }
  };
  write(files);
  for (const args of [
    ['init', '-q'],
    ['add', '-A'],
  ]) {
    assert.equal(spawnSync('git', args, { cwd: rootDir }).status, 0);
  }
  write(untracked);
  return rootDir;
};

const workflowWithJob = steps => `name: Example
on:
  push:
permissions:
  contents: read
jobs:
  recorder:
    runs-on: ubuntu-latest
    steps:
${steps}`;

const bareJob =
  workflowWithJob(`      - run: node scripts/record.mjs create --out outcome.json
`);
const installJob =
  workflowWithJob(`      - run: mise exec -- pnpm install --frozen-lockfile
      - run: node scripts/record.mjs create --out outcome.json
`);

const recorderFiles = {
  'scripts/record.mjs': "import { contract } from './contract.mjs';\n",
  'scripts/contract.mjs':
    "import YAML from 'yaml';\nexport const contract = YAML;\n",
};

test('a bare job whose script statically imports a package fails, naming job, entrypoint, chain and fix', t => {
  const rootDir = withRepository(t, recorderFiles);
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', bareJob, {
      rootDir,
    }),
    [
      '.github/workflows/example.yml job recorder has no dependency install, but scripts/record.mjs statically loads yaml via scripts/record.mjs -> scripts/contract.mjs; add a dependency install step to the job or move the import behind a dynamic import()',
    ],
  );
});

test('the same script passes in a job that installs dependencies', t => {
  const rootDir = withRepository(t, recorderFiles);
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', installJob, {
      rootDir,
    }),
    [],
  );
});

test('a dynamic import is a lazy boundary and builtins are always loadable', t => {
  const rootDir = withRepository(t, {
    'scripts/record.mjs':
      "import fs from 'node:fs';\nconst { contract } = await import('./contract.mjs');\n",
    'scripts/contract.mjs': "import YAML from 'yaml';\n",
  });
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', bareJob, {
      rootDir,
    }),
    [],
  );
});

test('CommonJS requires resolve without extensions and untracked files are unloadable', t => {
  const rootDir = withRepository(
    t,
    {
      'scripts/record.mjs': "import kit from './lib/kit.cjs';\n",
      'scripts/lib/kit.cjs':
        "const fs = require('fs');\nconst tracked = require('./tracked');\nconst local = require('./generated');\n",
      'scripts/lib/tracked.js': 'module.exports = {};\n',
    },
    { 'scripts/lib/generated.js': 'module.exports = {};\n' },
  );
  assert.deepEqual(
    findUnloadableImports(
      rootDir,
      'scripts/record.mjs',
      listTrackedFiles(rootDir),
    ),
    [
      {
        chain: ['scripts/record.mjs', 'scripts/lib/kit.cjs'],
        specifier: './generated',
      },
    ],
  );
});

test('an entrypoint that is not tracked is reported', t => {
  const rootDir = withRepository(t, { 'README.md': '' });
  assert.deepEqual(
    validateWorkflowContent('.github/workflows/example.yml', bareJob, {
      rootDir,
    }),
    [
      '.github/workflows/example.yml job recorder runs scripts/record.mjs, which is not a tracked file',
    ],
  );
});

test('static specifiers ignore comments, strings, templates, regexes and import.meta', () => {
  const source = `
    // import 'commented';
    /* export * from 'block'; */
    import a, { b as c } from './a.mjs';
    import './side-effect.mjs';
    export * as ns from './ns.mjs';
    export { d } from './d.mjs';
    export { e };
    const text = "import x from 'in-string'";
    const template = \`require('in-template') \${require('./in-expression.cjs')}\`;
    const pattern = /import 'in-regex'/u;
    const url = new URL('.', import.meta.url);
    const lazy = await import('lazy');
    object.require('member');
    const kit = require('./kit');
  `;
  assert.deepEqual(collectStaticSpecifiers(source), [
    './a.mjs',
    './side-effect.mjs',
    './ns.mjs',
    './d.mjs',
    './in-expression.cjs',
    './kit',
  ]);
});

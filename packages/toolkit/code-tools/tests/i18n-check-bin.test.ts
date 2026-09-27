import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from '@rstest/core';

const packageRoot = path.resolve(__dirname, '..');
const bin = path.join(packageRoot, 'bin/modern-i18n-check.mjs');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const workspace = (files: Record<string, string>): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-i18n-check-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return root;
};

const run = (root: string) => {
  expect(
    fs.existsSync(
      path.join(packageRoot, 'dist/esm-node/cli/workspace-source-check.js'),
    ),
    'Build @modern-js/code-tools before running the bin smoke test',
  ).toBe(true);
  return spawnSync(process.execPath, [bin], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ULTRAMODERN_WORKSPACE_ROOT: root },
  });
};

const violation = `export function App() {
  return <section data-mf-boundary="shell" />;
}
`;

test('modern-i18n-check reads sourceRoots from package.json and fails on a violation', () => {
  const root = workspace({
    'package.json': JSON.stringify({
      modernjs: { i18nCheck: { sourceRoots: ['sites'], locales: [] } },
    }),
    'sites/shell/src/App.tsx': violation,
    'apps/ignored/src/App.tsx': violation,
  });

  const result = run(root);

  expect(result.status, result.stderr).toBe(1);
  const output = `${result.stdout}${result.stderr}`;
  expect(output).toContain('sites/shell/src/App.tsx');
  expect(output).not.toContain('apps/ignored');
});

test.each([
  [{ sourceRoots: 'apps' }, '.sourceRoots" must be an array'],
  [{ locales: ['en_US'] }, '.locales" must be an array of BCP 47'],
  [
    { pluralCategories: [['one', 'other']] },
    '.pluralCategories" must be an object',
  ],
])('modern-i18n-check names the invalid package.json field %#', (i18nCheck, message) => {
  const root = workspace({
    'package.json': JSON.stringify({ modernjs: { i18nCheck } }),
  });

  const result = run(root);

  expect(result.status).toBe(2);
  expect(result.stderr).toContain(`"modernjs.i18nCheck${message}`);
});

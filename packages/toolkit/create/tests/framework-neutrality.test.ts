import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../../../..');
const forbiddenTerms = [
  ['Smart', ' Suggest'].join(''),
  ['smart', 'suggest'].join('_'),
  ['smart', 'suggest'].join('-'),
  ['Smart', 'Suggest'].join(''),
  ['SMART', 'SUGGEST'].join('_'),
];

const scannedRoots = [
  'packages/toolkit/create/src',
  'packages/toolkit/create/template-workspace',
  'packages/toolkit/create/templates',
  'packages/toolkit/create/tests',
  'packages/solutions/app-tools/src',
  'packages/solutions/app-tools/tests',
  '.codex/plans',
  '.codex/plan-graphs',
];

const skippedDirectories = new Set(['node_modules', 'dist', '.output', '.git']);

function collectTrackedFiles(root: string): string[] {
  try {
    return execFileSync('git', ['ls-files', root], {
      cwd: repoRoot,
      encoding: 'utf-8',
    })
      .split('\n')
      .filter(Boolean)
      .filter(file => fs.existsSync(path.join(repoRoot, file)))
      .map(file => path.join(repoRoot, file));
  } catch {
    return collectFiles(path.join(repoRoot, root));
  }
}

function collectFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

test('UltraModern framework source stays reference-app neutral', () => {
  const matches: string[] = [];

  for (const root of scannedRoots) {
    for (const file of collectTrackedFiles(root)) {
      const relativePath = path
        .relative(repoRoot, file)
        .split(path.sep)
        .join('/');
      const content = fs.readFileSync(file, 'utf-8');

      for (const term of forbiddenTerms) {
        if (content.includes(term) || relativePath.includes(term)) {
          matches.push(`${relativePath}: ${term}`);
        }
      }
    }
  }

  assert.deepEqual(matches, []);
});

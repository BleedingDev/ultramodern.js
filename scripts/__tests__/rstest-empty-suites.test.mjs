import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The shared preset sets passWithNoTests:false so a broken include glob or a
// package whose tests were deleted fails instead of reporting green.

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
// Run the bin script with node: the node_modules/.bin shim is not executable
// by spawnSync on Windows.
const rstestPackageJson = createRequire(import.meta.url).resolve(
  '@rstest/core/package.json',
);
const rstestBin = path.join(
  path.dirname(rstestPackageJson),
  JSON.parse(readFileSync(rstestPackageJson, 'utf8')).bin.rstest,
);

const trackedFiles = execFileSync('git', ['ls-files'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

test('no workspace script passes --passWithNoTests', () => {
  const offenders = trackedFiles
    .filter(file => path.basename(file) === 'package.json')
    .flatMap(file => {
      const { scripts = {} } = JSON.parse(
        readFileSync(path.join(repoRoot, file), 'utf8'),
      );
      return Object.entries(scripts)
        .filter(([, command]) => command.includes('passWithNoTests'))
        .map(([name]) => `${file} scripts.${name}`);
    });
  assert.deepEqual(
    offenders,
    [],
    'Delete --passWithNoTests; delete the test script and rstest config of a package that has no tests.',
  );
});

test('every rstest config and project matches at least one test file', async () => {
  const { loadConfig } = await import('@rstest/core');
  // The adapter fixture configs, and the tests aggregate that loads them as
  // projects, import the built @modern-js/adapter-rstest, which clean script
  // lanes do not build; the adapter integration run executes them instead.
  const configs = trackedFiles.filter(
    file =>
      /(^|\/)rstest(\.[\w-]+)?\.config\.m?[jt]s$/.test(file) &&
      !file.startsWith('tests/integration/') &&
      file !== 'tests/rstest.adapter.config.mts',
  );
  assert.ok(configs.length > 0);
  const empty = [];
  for (const config of configs) {
    const cwd = path.join(repoRoot, path.dirname(config));
    const result = spawnSync(
      process.execPath,
      [rstestBin, 'list', '--filesOnly', '--json', '-c', path.basename(config)],
      { cwd, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, `${config}: ${result.stderr}`);
    const listed = JSON.parse(result.stdout);
    if (listed.length === 0) {
      empty.push(config);
      continue;
    }
    // With several inline projects, each must contribute a file, or one
    // project's broken include glob hides behind a sibling's tests. Project
    // globs point at other configs, which this loop checks on their own; a
    // lone project is covered by the whole-config check above (rstest lists
    // its files without a project name).
    const { content } = await loadConfig({ cwd, path: path.basename(config) });
    const inlineProjects = (content.projects ?? []).filter(
      project => typeof project !== 'string',
    );
    if (inlineProjects.length < 2) {
      continue;
    }
    const listedProjects = new Set(listed.map(entry => entry.project));
    for (const project of inlineProjects) {
      assert.ok(project.name, `${config}: name every inline rstest project.`);
      if (!listedProjects.has(project.name)) {
        empty.push(`${config} project ${project.name}`);
      }
    }
  }
  assert.deepEqual(
    empty,
    [],
    'These rstest configs or projects match no test files. Fix the include glob, or delete the config or project and the package test script.',
  );
});

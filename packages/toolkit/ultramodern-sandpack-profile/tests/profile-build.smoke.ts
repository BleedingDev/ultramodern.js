import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { ultramodernSandpackFiles } from '../src/index.ts';

const fixtureRoots: string[] = [];
const repositoryRoot = path.resolve(import.meta.dirname, '../../../..');

async function listFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async entry => {
      const absolutePath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? listFiles(root, absolutePath)
        : [path.relative(root, absolutePath)];
    }),
  );
  return files.flat();
}

async function materializeBuildFixture() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'ultramodern-sandpack-build-'),
  );
  fixtureRoots.push(root);

  for (const [relativePath, source] of Object.entries(
    ultramodernSandpackFiles,
  )) {
    const outputPath = path.join(root, relativePath.replace(/^\//u, ''));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, source, 'utf8');
  }

  await symlink(
    path.join(repositoryRoot, 'node_modules'),
    path.join(root, 'node_modules'),
  );
  return root;
}

after(async () => {
  await Promise.all(
    fixtureRoots.map(root => rm(root, { force: true, recursive: true })),
  );
});

test('the materialized profile builds through the real Modern.js CLI', async () => {
  const fixtureRoot = await materializeBuildFixture();
  const modernCli = path.join(
    repositoryRoot,
    'packages/solutions/app-tools/bin/modern.js',
  );
  const cliMetadata = await lstat(modernCli);
  assert.equal(cliMetadata.isFile(), true);

  const result = spawnSync(process.execPath, [modernCli, 'build'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    },
    timeout: 180_000,
  });

  assert.equal(
    result.status,
    0,
    `modern build failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  const distRoot = path.join(fixtureRoot, 'dist');
  const emittedFiles = await listFiles(distRoot);
  const htmlPath = emittedFiles.find(file => file.endsWith('.html'));
  assert.ok(htmlPath, `build emitted no HTML: ${emittedFiles.join(', ')}`);
  assert.ok(
    emittedFiles.some(file => /\.(?:js|mjs)$/u.test(file)),
    `build emitted no JavaScript: ${emittedFiles.join(', ')}`,
  );

  const html = await readFile(path.join(distRoot, htmlPath), 'utf8');
  assert.match(html, /<script\b/u);
  assert.match(html, /<html\b[^>]*\blang=/u);
});

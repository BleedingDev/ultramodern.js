import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { ultramodernSandpackFiles } from '../src/index.ts';

const materializedRoots: string[] = [];

async function materializeProfile() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'ultramodern-sandpack-profile-'),
  );
  materializedRoots.push(root);

  for (const [relativePath, source] of Object.entries(
    ultramodernSandpackFiles,
  )) {
    const outputPath = path.join(root, relativePath.replace(/^\//u, ''));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, source, 'utf8');
  }

  return root;
}

after(async () => {
  await Promise.all(
    materializedRoots.map(root => rm(root, { force: true, recursive: true })),
  );
});

test('materializes an executable UltraModern single-app profile', async () => {
  const root = await materializeProfile();
  const manifest = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8'),
  );
  const tasks = JSON.parse(
    await readFile(path.join(root, '.codesandbox/tasks.json'), 'utf8'),
  );
  const environment = JSON.parse(
    await readFile(path.join(root, '.codesandbox/environment.json'), 'utf8'),
  );

  assert.equal(manifest.engines.node, '>=26.7.0');
  assert.equal(manifest.packageManager, 'pnpm@11.24.0');
  assert.equal(manifest.scripts.start, 'modern dev --host 0.0.0.0');
  assert.equal(manifest.scripts.build, 'modern build');
  assert.equal(tasks.tasks.start.command, 'pnpm start');
  assert.equal(environment.nodeVersion, '26');

  for (const packageName of [
    '@modern-js/app-tools',
    '@modern-js/plugin-i18n',
    '@modern-js/plugin-tanstack',
    '@modern-js/runtime',
  ]) {
    const selector =
      manifest.dependencies?.[packageName] ??
      manifest.devDependencies?.[packageName];
    assert.match(
      selector,
      new RegExp(
        `^npm:@bleedingdev/modern-js-${packageName.split('/').at(-1)}@`,
        'u',
      ),
    );
  }

  assert.equal(manifest.dependencies.effect, '4.0.0-rc.112');
  assert.equal(manifest.dependencies.i18next, '26.3.6');
  assert.equal(manifest.devDependencies.tailwindcss, '4.3.3');
  assert.equal(
    manifest.devDependencies['@rsbuild/plugin-tailwindcss'],
    '2.0.3',
  );
});

test('declares every UltraModern capability in executable entrypoints', async () => {
  const root = await materializeProfile();
  const config = await readFile(path.join(root, 'modern.config.ts'), 'utf8');
  const runtime = await readFile(
    path.join(root, 'src/modern.runtime.ts'),
    'utf8',
  );
  const layout = await readFile(
    path.join(root, 'src/routes/layout.tsx'),
    'utf8',
  );
  const page = await readFile(path.join(root, 'src/routes/page.tsx'), 'utf8');
  const styles = await readFile(
    path.join(root, 'src/routes/index.css'),
    'utf8',
  );

  assert.match(config, /tanstackRouterPlugin\(\)/u);
  assert.match(config, /i18nPlugin\(/u);
  assert.match(config, /pluginTailwindcss\(\)/u);
  assert.match(runtime, /framework: 'tanstack'/u);
  assert.match(runtime, /supportedLngs: \['en', 'cs'\]/u);
  assert.match(layout, /@modern-js\/plugin-tanstack\/runtime/u);
  assert.match(layout, /prefetch="render"/u);
  assert.match(page, /Effect\.runSync/u);
  assert.match(page, /useModernI18n/u);
  assert.match(styles, /@import 'tailwindcss'/u);
});

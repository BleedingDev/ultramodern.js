import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const overlay = require('./fixtures/native-resource-overlay/index.cjs');

async function ownedStage(t, renderer) {
  const owner = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-overlay-unit-'),
  );
  t.after(() => fs.rm(owner, { recursive: true, force: true }));
  const outputWorkspaceRoot = path.join(owner, 'physical-stage');
  const appRoot = path.join(outputWorkspaceRoot, 'apps/native-app');
  await fs.mkdir(path.join(appRoot, 'src/components'), { recursive: true });
  await fs.writeFile(
    path.join(appRoot, 'tsconfig.json'),
    '{"compilerOptions":{"types":["node"]}}',
  );
  await fs.writeFile(
    path.join(appRoot, 'package.json'),
    JSON.stringify({
      name: 'native-overlay-unit',
      private: true,
      engines: { node: '>=26.10.0' },
      devDependencies: { 'unit-existing-tool': '1.0.0' },
    }),
  );
  const workspaceRoot = path.join(owner, 'logical-output');
  await fs.mkdir(workspaceRoot);
  await fs.writeFile(path.join(workspaceRoot, 'preserve.txt'), 'logical-owner');
  return {
    owner,
    appRoot,
    config: {
      outputWorkspaceRoot,
      workspaceRoot,
      generatedApp: { directory: 'apps/native-app', renderer },
    },
  };
}

test('native resource overlay writes public-hook source only in the physical generation stage', async t => {
  for (const renderer of ['solid', 'octane']) {
    const { appRoot, config } = await ownedStage(t, renderer);
    await overlay({ config });
    const counter = await fs.readFile(
      path.join(appRoot, 'src/components/Counter.tsx'),
      'utf8',
    );
    assert.match(counter, /observeResource\('counter'\)/u);
    assert.match(counter, renderer === 'solid' ? /onCleanup/u : /useEffect/u);
    const strict = JSON.parse(
      await fs.readFile(
        path.join(appRoot, 'tsconfig.native-browser.json'),
        'utf8',
      ),
    );
    assert.deepEqual(strict.compilerOptions.types, []);
    assert.equal(strict.compilerOptions.skipLibCheck, false);
    assert.deepEqual(strict.files, [
      `node_modules/.modern-js/${renderer}/main/index.ts`,
    ]);
    assert.deepEqual(strict.include, ['src/**/*.tsx', 'src/**/*.tsrx']);
    assert.deepEqual(strict.exclude, []);
    const host = JSON.parse(
      await fs.readFile(
        path.join(appRoot, 'tsconfig.native-server.json'),
        'utf8',
      ),
    );
    assert.deepEqual(host.compilerOptions.types, ['node']);
    assert.equal(host.compilerOptions.skipLibCheck, false);
    assert.deepEqual(host.files, [
      'modern.config.ts',
      `node_modules/.modern-js/${renderer}/main/index.server.ts`,
    ]);
    assert.equal(
      await fs.readFile(
        path.join(config.workspaceRoot, 'preserve.txt'),
        'utf8',
      ),
      'logical-owner',
    );
    assert.deepEqual(await fs.readdir(config.workspaceRoot), ['preserve.txt']);
    await assert.rejects(overlay({ config }), /EEXIST/u);
  }
});

test('native resource overlay rejects an escaping app or linked source target', async t => {
  const { owner, appRoot, config } = await ownedStage(t, 'solid');
  const outside = path.join(owner, 'other-owner');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'preserve.tsx'), 'other-source');
  await fs.symlink(
    outside,
    path.join(config.outputWorkspaceRoot, 'apps/escape'),
  );
  await assert.rejects(
    overlay({
      config: {
        ...config,
        generatedApp: { directory: 'apps/escape', renderer: 'solid' },
      },
    }),
    /physical generator stage/u,
  );
  await fs.symlink(
    path.join(outside, 'preserve.tsx'),
    path.join(appRoot, 'src/components/Counter.tsx'),
  );
  await assert.rejects(overlay({ config }), /linked or non-file/u);
  assert.equal(
    await fs.readFile(path.join(outside, 'preserve.tsx'), 'utf8'),
    'other-source',
  );
});

test('two-entry overlay authoring occurs in the stage before native configuration capture', async t => {
  const { appRoot, config } = await ownedStage(t, 'solid');
  await fs.mkdir(path.join(appRoot, 'src/routes'));
  await fs.writeFile(
    path.join(appRoot, 'src/routes/page.tsx'),
    'export default function Page() {}',
  );
  const base =
    "export default {renderer:'solid',server:{port:4195,ssr:true}};\n";
  await fs.writeFile(path.join(appRoot, 'modern.config.ts'), base);
  await overlay({ config: { ...config, twoEntryConformance: true } });
  assert.equal(
    await fs.readFile(
      path.join(appRoot, 'modern.entry-base.config.ts'),
      'utf8',
    ),
    base,
  );
  for (const entry of ['ssr', 'csr'])
    assert.match(
      await fs.readFile(
        path.join(appRoot, `src/${entry}/components/Counter.tsx`),
        'utf8',
      ),
      /observeResource\('counter'\)/u,
    );
  // The generator's guarded starter source surface stays in place.
  assert.equal(
    await fs.readFile(path.join(appRoot, 'src/routes/page.tsx'), 'utf8'),
    'export default function Page() {}',
  );
  assert.equal(
    (await fs.readdir(path.join(appRoot, 'src/ssr'))).includes('ssr'),
    false,
  );
  const manifest = JSON.parse(
    await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'),
  );
  assert.deepEqual(manifest.engines, { node: '>=26.10.0' });
  assert.deepEqual(manifest.devDependencies, {
    'unit-existing-tool': '1.0.0',
    '@rsbuild/core': '2.2.9',
  });
  assert.equal(
    await fs.readFile(path.join(appRoot, 'observe-native-compiler.ts'), 'utf8'),
    await fs.readFile(
      new URL('./fixtures/observe-native-compiler.ts', import.meta.url),
      'utf8',
    ),
  );
  assert.match(
    await fs.readFile(path.join(appRoot, 'modern.config.ts'), 'utf8'),
    /builderPlugins: \[\.\.\.\(authoredConfig.builderPlugins \?\? \[\]\), observeNativeCompiler\(\)\]/u,
  );
  assert.deepEqual(await fs.readdir(config.workspaceRoot), ['preserve.txt']);
});

test('authored conformance overlay uses the genuine generated catalog aliases before capture', async t => {
  const { appRoot, config } = await ownedStage(t, 'solid');
  await fs.writeFile(
    path.join(appRoot, 'modern.config.ts'),
    "export default {renderer:'solid',server:{ssr:true}};\n",
  );
  await overlay({
    config: { ...config, conformanceRoutes: true, twoEntryConformance: true },
  });
  const page = await fs.readFile(
    path.join(appRoot, 'src/ssr/routes/page.tsx'),
    'utf8',
  );
  assert.match(page, /@modern-js\/renderer-solid\/router/u);
  assert.equal(page.includes('@bleedingdev/'), false);
  assert.match(page, /Generated Solid consumer/u);
  assert.match(
    await fs.readFile(
      path.join(appRoot, 'src/csr/routes/page.head.ts'),
      'utf8',
    ),
    /@modern-js\/renderer-solid\/router/u,
  );
  assert.deepEqual(await fs.readdir(config.workspaceRoot), ['preserve.txt']);
});

test('native overlay rejects linked physical stages and logical workspace aliases', async t => {
  for (const kind of ['linked-stage', 'logical-stage']) {
    const { owner, appRoot, config } = await ownedStage(t, 'solid');
    if (kind === 'linked-stage') {
      const link = path.join(owner, 'linked-stage');
      await fs.symlink(config.outputWorkspaceRoot, link);
      config.outputWorkspaceRoot = link;
    } else config.workspaceRoot = config.outputWorkspaceRoot;
    await assert.rejects(overlay({ config }), /physical generator stage/u);
    await assert.rejects(
      fs.stat(path.join(appRoot, 'src/components/Counter.tsx')),
      /ENOENT/u,
    );
    await assert.rejects(
      fs.stat(path.join(appRoot, 'tsconfig.native-browser.json')),
      /ENOENT/u,
    );
  }
});

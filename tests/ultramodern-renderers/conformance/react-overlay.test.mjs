import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const overlay = createRequire(import.meta.url)(
  './fixtures/react-resource-overlay/index.cjs',
);

async function ownedStage(t) {
  const owner = await fs.mkdtemp(path.join(os.tmpdir(), 'react-overlay-unit-'));
  t.after(() => fs.rm(owner, { recursive: true, force: true }));
  const stage = path.join(owner, 'physical-stage');
  const appRoot = path.join(stage, 'apps/react-app');
  await fs.mkdir(path.join(appRoot, 'src/routes'), { recursive: true });
  const baseline = {
    'modern.config.ts':
      "export default {renderer:'react',plugins:['existing-providers'],source:{entries:{worker:'./src/worker.ts'}},server:{port:4100,routes:{worker:'/worker'},ssrByEntries:{worker:false}}};\n",
    'tsconfig.json': '{"compilerOptions":{"types":["node"],"strict":true}}',
    'src/runtime.tsx': 'export const runtime = "existing-runtime";\n',
    'src/bootstrap.tsx': 'export const bootstrap = "existing-bootstrap";\n',
    'src/routes/page.tsx': 'export default function ExistingPage() {}\n',
    'src/worker.ts': 'export const worker = "existing-worker";\n',
  };
  for (const [file, bytes] of Object.entries(baseline))
    await fs.writeFile(path.join(appRoot, file), bytes);
  await fs.writeFile(
    path.join(appRoot, 'package.json'),
    JSON.stringify({
      name: 'react-observer-unit',
      devDependencies: { 'existing-tool': '1.0.0' },
      engines: { node: '>=26.7.0' },
    }),
  );
  const workspaceRoot = path.join(owner, 'logical-root');
  await fs.mkdir(workspaceRoot);
  await fs.writeFile(path.join(workspaceRoot, 'preserve.txt'), 'logical-owner');
  return {
    owner,
    appRoot,
    baseline,
    config: {
      outputWorkspaceRoot: stage,
      workspaceRoot,
      generatedApp: { renderer: 'react', directory: 'apps/react-app' },
    },
  };
}

test('React overlay adds actual entry sources and preserves runtime/bootstrap/provider authoring', async t => {
  const { appRoot, baseline, config } = await ownedStage(t);
  await overlay({ config });
  for (const [file, bytes] of Object.entries(baseline))
    assert.equal(
      await fs.readFile(
        path.join(
          appRoot,
          file === 'modern.config.ts' ? 'modern.entry-base.config.ts' : file,
        ),
        'utf8',
      ),
      bytes,
    );
  const assembled = await fs.readFile(
    path.join(appRoot, 'modern.config.ts'),
    'utf8',
  );
  assert.equal(assembled.includes('defineConfig('), false);
  assert.match(assembled, /mainEntryName: 'ssr'/u);
  assert.match(assembled, /mode: 'stream' as const/u);
  const executable = assembled
    .replace(
      "import authoredConfig from './modern.entry-base.config';",
      baseline['modern.config.ts'].replace(
        'export default ',
        'const authoredConfig = ',
      ),
    )
    .replace(
      "import { observeNativeCompiler } from './observe-native-compiler';",
      `import { observeNativeCompiler } from ${JSON.stringify(new URL('./fixtures/observe-native-compiler.ts', import.meta.url).href)};`,
    )
    .replace(' as const', '');
  const { default: effective } = await import(
    `data:text/javascript,${encodeURIComponent(executable)}`
  );
  assert.deepEqual(effective.source.entries, {
    worker: './src/worker.ts',
    ssr: './src/ssr/routes',
    csr: './src/csr/routes',
  });
  assert.equal(effective.server.routes.worker, '/worker');
  assert.equal(effective.server.ssrByEntries.worker, false);
  assert.equal(effective.server.ssrByEntries.csr, false);
  assert.strictEqual(effective.server.ssrByEntries.ssr, effective.server.ssr);
  assert.deepEqual(effective.plugins, ['existing-providers']);
  assert.equal(effective.builderPlugins.length, 1);
  assert.equal(typeof effective.builderPlugins[0].setup, 'function');
  const packageManifest = JSON.parse(
    await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'),
  );
  assert.equal(packageManifest.devDependencies['@rsbuild/core'], '2.2.9');
  assert.equal(packageManifest.devDependencies['existing-tool'], '1.0.0');
  assert.equal(packageManifest.engines.node, '>=26.7.0');
  assert.equal(
    await fs.readFile(path.join(appRoot, 'observe-native-compiler.ts'), 'utf8'),
    await fs.readFile(
      new URL('./fixtures/observe-native-compiler.ts', import.meta.url),
      'utf8',
    ),
  );
  for (const entry of ['ssr', 'csr']) {
    const page = await fs.readFile(
      path.join(appRoot, `src/${entry}/routes/page.tsx`),
      'utf8',
    );
    assert.match(page, /@modern-js\/plugin-tanstack\/runtime/u);
    assert.match(page, /Generated React consumer/u);
    assert.equal(page.includes('@bleedingdev/'), false);
    assert.match(
      await fs.readFile(
        path.join(appRoot, `src/${entry}/components/Counter.tsx`),
        'utf8',
      ),
      /useEffect/u,
    );
    assert.ok(
      (
        await fs.stat(
          path.join(appRoot, `src/${entry}/conformance-controls.ts`),
        )
      ).isFile(),
    );
  }
  const program = JSON.parse(
    await fs.readFile(
      path.join(appRoot, 'tsconfig.react-acceptance.json'),
      'utf8',
    ),
  );
  assert.equal(program.compilerOptions.skipLibCheck, false);
  assert.equal(program.compilerOptions.types, undefined);
  assert.ok(program.include.includes('node_modules/.modern-js'));
  assert.deepEqual(program.exclude, []);
  assert.deepEqual(await fs.readdir(config.workspaceRoot), ['preserve.txt']);
  await assert.rejects(overlay({ config }), /EEXIST/u);
});

test('React overlay rejects an unrelated compiler provider before config and entry authoring', async t => {
  const { appRoot, baseline, config } = await ownedStage(t);
  const manifest = JSON.stringify({
    name: 'react-observer-unit',
    devDependencies: { '@rsbuild/core': '9.0.0' },
  });
  await fs.writeFile(path.join(appRoot, 'package.json'), manifest);
  await assert.rejects(
    overlay({ config }),
    /manifest-bound maintained Rsbuild provider/u,
  );
  assert.equal(
    await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'),
    manifest,
  );
  assert.equal(
    await fs.readFile(path.join(appRoot, 'modern.config.ts'), 'utf8'),
    baseline['modern.config.ts'],
  );
  await assert.rejects(fs.stat(path.join(appRoot, 'src/ssr')), {
    code: 'ENOENT',
  });
});

test('React overlay rejects an escaping or linked authoring target before modifying baseline', async t => {
  for (const kind of [
    'escape',
    'linked-src',
    'linked-config',
    'existing-entry',
  ]) {
    const { owner, appRoot, baseline, config } = await ownedStage(t);
    const outside = path.join(owner, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'preserve.ts'), 'outside-owner');
    if (kind === 'escape') config.generatedApp.directory = '../../../outside';
    else if (kind === 'linked-src') {
      await fs.rename(
        path.join(appRoot, 'src'),
        path.join(appRoot, 'preserved-src'),
      );
      await fs.symlink(outside, path.join(appRoot, 'src'));
    } else if (kind === 'linked-config') {
      await fs.unlink(path.join(appRoot, 'modern.config.ts'));
      await fs.symlink(
        path.join(outside, 'preserve.ts'),
        path.join(appRoot, 'modern.config.ts'),
      );
    } else await fs.mkdir(path.join(appRoot, 'src/ssr'));
    await assert.rejects(overlay({ config }), /escapes|ordinary|EEXIST/u);
    assert.equal(
      await fs.readFile(path.join(outside, 'preserve.ts'), 'utf8'),
      'outside-owner',
    );
    if (kind !== 'linked-config')
      assert.equal(
        await fs.readFile(path.join(appRoot, 'modern.config.ts'), 'utf8'),
        baseline['modern.config.ts'],
      );
    await assert.rejects(
      fs.stat(path.join(appRoot, 'modern.entry-base.config.ts')),
      /ENOENT/u,
    );
  }
});

test('React overlay rejects a linked physical stage and a stage equal to the logical workspace', async t => {
  for (const kind of ['linked-stage', 'logical-stage']) {
    const { owner, appRoot, baseline, config } = await ownedStage(t);
    if (kind === 'linked-stage') {
      const link = path.join(owner, 'linked-stage');
      await fs.symlink(config.outputWorkspaceRoot, link);
      config.outputWorkspaceRoot = link;
    } else config.workspaceRoot = config.outputWorkspaceRoot;
    await assert.rejects(overlay({ config }), /physical generator stage/u);
    assert.equal(
      await fs.readFile(path.join(appRoot, 'modern.config.ts'), 'utf8'),
      baseline['modern.config.ts'],
    );
    await assert.rejects(fs.stat(path.join(appRoot, 'src/ssr')), /ENOENT/u);
  }
});

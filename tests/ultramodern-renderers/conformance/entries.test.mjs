import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { authorEntryVariants } from '../../../scripts/ultramodern-renderers/acceptance/entries.mjs';

async function ownedAuthoringInput(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'entry-authoring-unit-'),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'src/routes'), { recursive: true });
  await fs.mkdir(path.join(root, 'src/components'));
  await fs.writeFile(
    path.join(root, 'src/routes/page.tsx'),
    'export default function NativePage() {}',
  );
  await fs.writeFile(
    path.join(root, 'src/components/Counter.tsx'),
    'export default function Counter() {}',
  );
  const config =
    "export default {renderer:'solid',server:{port:4195,ssr:true},plugins:['original-plugin-input']};\n";
  await fs.writeFile(path.join(root, 'modern.config.ts'), config);
  return { root, config };
}

test('entry authoring preserves config input once and emits actual distinct source directories', async t => {
  const { root, config } = await ownedAuthoringInput(t);
  const entries = await authorEntryVariants(root);
  assert.deepEqual(Object.keys(entries), ['ssr', 'csr']);
  assert.equal(
    await fs.readFile(path.join(root, 'modern.entry-base.config.ts'), 'utf8'),
    config,
  );
  const assembled = await fs.readFile(
    path.join(root, 'modern.config.ts'),
    'utf8',
  );
  assert.match(assembled, /import authoredConfig/u);
  assert.equal(assembled.includes('defineConfig('), false);
  for (const entry of ['ssr', 'csr']) {
    assert.equal(entries[entry].routePrefix, `/${entry}`);
    assert.equal(
      await fs.readFile(
        path.join(root, `src/${entry}/routes/page.tsx`),
        'utf8',
      ),
      'export default function NativePage() {}',
    );
    assert.ok(
      (await fs.stat(path.join(root, entries[entry].counterFile))).isFile(),
    );
  }
  assert.deepEqual(await fs.readdir(path.join(root, 'src')), ['csr', 'ssr']);
  assert.equal(
    (await fs.readdir(root)).some(name =>
      name.startsWith('.acceptance-entry-authoring-'),
    ),
    false,
  );
  await assert.rejects(authorEntryVariants(root), /EEXIST/u);
  assert.equal(
    await fs.readFile(path.join(root, 'modern.config.ts'), 'utf8'),
    assembled,
  );
});

test('retained-source entry authoring adds entry copies beside the original source', async t => {
  const { root } = await ownedAuthoringInput(t);
  const entries = await authorEntryVariants(root, { retainSource: true });
  assert.deepEqual(Object.keys(entries), ['ssr', 'csr']);
  assert.deepEqual((await fs.readdir(path.join(root, 'src'))).sort(), [
    'components',
    'csr',
    'routes',
    'ssr',
  ]);
  for (const prefix of ['src', 'src/ssr', 'src/csr'])
    assert.equal(
      await fs.readFile(path.join(root, prefix, 'routes/page.tsx'), 'utf8'),
      'export default function NativePage() {}',
    );
  assert.deepEqual((await fs.readdir(path.join(root, 'src/ssr'))).sort(), [
    'components',
    'routes',
  ]);
  assert.equal(
    (await fs.readdir(root)).some(name =>
      name.startsWith('.acceptance-entry-authoring-'),
    ),
    false,
  );
  await assert.rejects(
    authorEntryVariants(root, { retainSource: true }),
    /EEXIST/u,
  );
});

test('entry copies re-anchor relative imports that leave the source tree', async t => {
  for (const retainSource of [false, true]) {
    const { root } = await ownedAuthoringInput(t);
    const reexport =
      "export { ultramodernBuildMarker } from '../shared/ultramodern-build';\n";
    await fs.writeFile(path.join(root, 'src/ultramodern-build.ts'), reexport);
    const page =
      "import Counter from '../components/Counter';\nimport { ultramodernBuildMarker } from '../ultramodern-build';\nconst css = import('../../styles/app.css');\nexport default function NativePage() {}\n";
    await fs.writeFile(path.join(root, 'src/routes/page.tsx'), page);
    await authorEntryVariants(root, { retainSource });
    for (const entry of ['ssr', 'csr']) {
      assert.equal(
        await fs.readFile(
          path.join(root, `src/${entry}/ultramodern-build.ts`),
          'utf8',
        ),
        "export { ultramodernBuildMarker } from '../../shared/ultramodern-build';\n",
      );
      assert.equal(
        await fs.readFile(
          path.join(root, `src/${entry}/routes/page.tsx`),
          'utf8',
        ),
        page.replace("'../../styles/app.css'", "'../../../styles/app.css'"),
      );
    }
    if (retainSource)
      assert.equal(
        await fs.readFile(path.join(root, 'src/ultramodern-build.ts'), 'utf8'),
        reexport,
      );
  }
});

test('linked source and pre-existing entry input are rejected without modifying either owner', async t => {
  for (const mode of ['link', 'existing']) {
    const { root, config } = await ownedAuthoringInput(t);
    if (mode === 'link')
      await fs.symlink('../modern.config.ts', path.join(root, 'src/link.ts'));
    else await fs.mkdir(path.join(root, 'src/ssr'));
    await assert.rejects(authorEntryVariants(root), /linked|EEXIST/u);
    assert.equal(
      await fs.readFile(path.join(root, 'modern.config.ts'), 'utf8'),
      config,
    );
    assert.equal(
      await fs.readFile(path.join(root, 'src/routes/page.tsx'), 'utf8'),
      'export default function NativePage() {}',
    );
    await assert.rejects(
      fs.stat(path.join(root, 'modern.entry-base.config.ts')),
      /ENOENT/u,
    );
  }
});

test('entry authoring preserves the authored SSR stream policy for the real SSR entry', async t => {
  for (const policy of [
    undefined,
    false,
    true,
    { mode: 'stream', preload: true },
  ]) {
    const { root } = await ownedAuthoringInput(t);
    const authored = { renderer: 'react', server: { ssr: policy, port: 4195 } };
    await fs.writeFile(
      path.join(root, 'modern.config.ts'),
      `export default ${JSON.stringify(authored)};\n`,
    );
    await authorEntryVariants(root);
    const assembled = await fs.readFile(
      path.join(root, 'modern.config.ts'),
      'utf8',
    );
    const executable = assembled.replace(
      "import authoredConfig from './modern.entry-base.config';",
      `const authoredConfig = ${JSON.stringify(authored)};`,
    );
    const { default: selected } = await import(
      `data:text/javascript,${encodeURIComponent(executable)}`
    );
    assert.deepEqual(selected.server.ssr, policy || true);
    assert.strictEqual(selected.server.ssrByEntries.ssr, selected.server.ssr);
    assert.equal(selected.server.ssrByEntries.csr, false);
    assert.equal(selected.server.port, 4195);
  }
});

test('native entry authoring cannot mask absent or false generated server SSR', async t => {
  for (const renderer of ['solid', 'octane'])
    for (const ssr of [undefined, false]) {
      const { root } = await ownedAuthoringInput(t);
      const authored = { renderer, server: { ssr }, output: { ssr: true } };
      const original = `export default ${JSON.stringify(authored)};\n`;
      await fs.writeFile(path.join(root, 'modern.config.ts'), original);
      await authorEntryVariants(root);
      assert.equal(
        await fs.readFile(
          path.join(root, 'modern.entry-base.config.ts'),
          'utf8',
        ),
        original,
      );
      const assembled = await fs.readFile(
        path.join(root, 'modern.config.ts'),
        'utf8',
      );
      const executable = assembled.replace(
        "import authoredConfig from './modern.entry-base.config';",
        `const authoredConfig = ${JSON.stringify(authored)};`,
      );
      await assert.rejects(
        import(`data:text/javascript,${encodeURIComponent(executable)}`),
        /must enable SSR through server.ssr/,
      );
    }
});

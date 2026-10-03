import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createHandAuthoredConsumer,
  MAINTAINED_NATIVE_TRANSPORTS,
  requiredFixtureDependencies,
} from '../../../scripts/ultramodern-renderers/acceptance/fixtures.mjs';

test('authored fixture uses mapped public configuration and isolated native JSX types', async t => {
  const owner = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-authored-fixture-unit-'),
  );
  t.after(() => fs.rm(owner, { recursive: true, force: true }));
  for (const renderer of ['react', 'solid', 'octane']) {
    const consumerRoot = path.join(owner, renderer);
    const result = await createHandAuthoredConsumer({
      consumerRoot,
      renderer,
      minimumNode: '26.7.0',
      dependencySpecs: Object.fromEntries(
        requiredFixtureDependencies(renderer).map(name => [
          name,
          '1.0.0-unit.1',
        ]),
      ),
      scripts: { typecheck: 'unit-only-typecheck', build: 'unit-only-build' },
    });
    assert.equal(result.cleanupPath, consumerRoot);
    assert.match(result.sourceSha256, /^[a-f\d]{64}$/u);
    const config = await fs.readFile(
      path.join(consumerRoot, 'modern.entry-base.config.ts'),
      'utf8',
    );
    assert.match(config, /@bleedingdev\/modern-js-ultramodern-app-tools/);
    assert.match(config, new RegExp(`renderer: '${renderer}'`));
    assert.deepEqual(Object.keys(result.entries), ['ssr', 'csr']);
    const assembledConfig = await fs.readFile(
      path.join(consumerRoot, 'modern.config.ts'),
      'utf8',
    );
    assert.match(assembledConfig, /ssrByEntries: \{ csr: false, ssr \}/u);
    assert.match(assembledConfig, /observeNativeCompiler\(\)/u);
    assert.equal(
      await fs.readFile(
        path.join(consumerRoot, 'observe-native-compiler.ts'),
        'utf8',
      ),
      await fs.readFile(
        new URL('./fixtures/observe-native-compiler.ts', import.meta.url),
        'utf8',
      ),
    );
    assert.match(
      await fs.readFile(
        path.join(consumerRoot, 'src/ssr/routes/page.tsx'),
        'utf8',
      ),
      /export default/u,
    );
    assert.match(
      await fs.readFile(
        path.join(consumerRoot, 'src/csr/routes/page.tsx'),
        'utf8',
      ),
      /export default/u,
    );
    const tsconfig = JSON.parse(
      await fs.readFile(path.join(consumerRoot, 'tsconfig.json'), 'utf8'),
    );
    if (renderer !== 'react')
      assert.equal(tsconfig.compilerOptions.types.includes('react'), false);
    if (renderer !== 'react') {
      assert.ok(tsconfig.include.includes('node_modules/.modern-js'));
      assert.deepEqual(tsconfig.compilerOptions.types, ['node']);
      assert.deepEqual(tsconfig.exclude, []);
      const browser = JSON.parse(
        await fs.readFile(
          path.join(consumerRoot, 'tsconfig.native-browser.json'),
          'utf8',
        ),
      );
      const server = JSON.parse(
        await fs.readFile(
          path.join(consumerRoot, 'tsconfig.native-server.json'),
          'utf8',
        ),
      );
      assert.deepEqual(browser.compilerOptions.types, []);
      assert.deepEqual(server.compilerOptions.types, ['node']);
      assert.deepEqual(browser.include, ['src/**/*.tsx', 'src/**/*.tsrx']);
      assert.deepEqual(
        browser.files,
        ['ssr', 'csr'].map(
          entry => `node_modules/.modern-js/${renderer}/${entry}/index.ts`,
        ),
      );
      assert.deepEqual(server.files, [
        'modern.config.ts',
        ...['ssr', 'csr'].map(
          entry =>
            `node_modules/.modern-js/${renderer}/${entry}/index.server.ts`,
        ),
      ]);
    }
    if (renderer === 'solid')
      assert.equal(tsconfig.compilerOptions.jsxImportSource, '@solidjs/web');
    if (renderer === 'octane')
      assert.equal(tsconfig.tsrx.compiler, 'octane/compiler/volar');
  }
});

test('authored fixture preserves exact maintained native archives and Node host types', async t => {
  const owner = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-authored-maintained-unit-'),
  );
  t.after(() => fs.rm(owner, { recursive: true, force: true }));
  const consumerRoot = path.join(owner, 'consumer');
  const dependencySpecs = Object.fromEntries(
    requiredFixtureDependencies('octane').map(name => [name, '3.8.3']),
  );
  for (const transport of Object.values(MAINTAINED_NATIVE_TRANSPORTS))
    dependencySpecs[transport.name] = transport.url;
  dependencySpecs['@types/node'] = '26.6.2';
  await createHandAuthoredConsumer({
    consumerRoot,
    renderer: 'octane',
    minimumNode: '26.7.0',
    dependencySpecs,
    scripts: { typecheck: 'unit-only-typecheck', build: 'unit-only-build' },
  });
  const manifest = JSON.parse(
    await fs.readFile(path.join(consumerRoot, 'package.json'), 'utf8'),
  );
  for (const transport of Object.values(MAINTAINED_NATIVE_TRANSPORTS))
    assert.equal(manifest.dependencies[transport.name], transport.url);
  assert.equal(manifest.dependencies['@types/node'], '26.6.2');
});

test('configured maintained transport tuple agrees with the built owning renderer profile', () => {
  const require = createRequire(
    new URL(
      '../../../packages/solutions/ultramodern-app-tools/package.json',
      import.meta.url,
    ),
  );
  const profile =
    require('@modern-js/ultramodern-app-tools').resolveRendererProfile(
      'octane',
    );
  assert.equal(
    profile.hydration.version,
    MAINTAINED_NATIVE_TRANSPORTS.octane.version,
  );
  assert.equal(
    profile.router.version,
    MAINTAINED_NATIVE_TRANSPORTS['@octanejs/tanstack-router'].version,
  );
  for (const transport of Object.values(MAINTAINED_NATIVE_TRANSPORTS)) {
    assert.equal(profile.dependencies[transport.name], transport.url);
    assert.equal(transport.renderer, profile.renderer);
    assert.equal(
      Buffer.from(transport.integrity.slice(7), 'base64').length,
      64,
    );
    assert.match(transport.sha256, /^[a-f\d]{64}$/u);
    assert.ok(Object.isFrozen(transport));
  }
  assert.ok(Object.isFrozen(MAINTAINED_NATIVE_TRANSPORTS));
});

test('authored fixture rejects altered transport tuples and maintained registry substitutions before writes', async t => {
  const owner = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-authored-transport-rejection-'),
  );
  t.after(() => fs.rm(owner, { recursive: true, force: true }));
  const consumerRoot = path.join(owner, 'consumer');
  const input = {
    consumerRoot,
    renderer: 'octane',
    minimumNode: '26.7.0',
    scripts: { typecheck: 'unit-only-typecheck', build: 'unit-only-build' },
  };
  const dependencies = Object.fromEntries(
    requiredFixtureDependencies('octane').map(name => [name, '1.0.0-unit.1']),
  );
  for (const [name, spec] of [
    ['octane', `${MAINTAINED_NATIVE_TRANSPORTS.octane.url}?unverified=1`],
    ['octane', `${MAINTAINED_NATIVE_TRANSPORTS.octane.url}.provenance.json`],
    ['octane', 'https://example.com/octane.tgz'],
    ['octane', MAINTAINED_NATIVE_TRANSPORTS['@octanejs/tanstack-router'].url],
    ['unrelated', MAINTAINED_NATIVE_TRANSPORTS.octane.url],
    ...Object.values(MAINTAINED_NATIVE_TRANSPORTS).map(transport => [
      transport.name,
      transport.version,
    ]),
  ]) {
    await assert.rejects(
      createHandAuthoredConsumer({
        ...input,
        dependencySpecs: { ...dependencies, [name]: spec },
      }),
      /exact maintained archive tuple|exact public archive URL/u,
    );
    await assert.rejects(fs.lstat(consumerRoot), { code: 'ENOENT' });
  }
  for (const renderer of ['react', 'solid']) {
    await assert.rejects(
      createHandAuthoredConsumer({
        ...input,
        renderer,
        dependencySpecs: {
          ...Object.fromEntries(
            requiredFixtureDependencies(renderer).map(name => [
              name,
              '1.0.0-unit.1',
            ]),
          ),
          octane: MAINTAINED_NATIVE_TRANSPORTS.octane.url,
        },
      }),
      /transport requires renderer octane/u,
    );
    await assert.rejects(fs.lstat(consumerRoot), { code: 'ENOENT' });
  }
});

test('authored fixture refuses an existing path and broad or workspace dependency ranges', async t => {
  const owner = await fs.mkdtemp(
    path.join(os.tmpdir(), 'renderer-authored-rejection-unit-'),
  );
  t.after(() => fs.rm(owner, { recursive: true, force: true }));
  const input = {
    consumerRoot: path.join(owner, 'consumer'),
    renderer: 'solid',
    minimumNode: '26.7.0',
    dependencySpecs: Object.fromEntries(
      requiredFixtureDependencies('solid').map(name => [name, '1.0.0-unit.1']),
    ),
    scripts: { typecheck: 'unit-only-typecheck', build: 'unit-only-build' },
  };
  for (const version of [
    'workspace:*',
    '^1.0.0',
    'latest',
    '01.0.0',
    '1.0.0-01',
    '1.0.0+ultramodern..hash',
    '1.0.0+ultramodern hash',
    '1.0.0-',
    '1.0.0+',
    '1.0.0+\u212A',
  ]) {
    await assert.rejects(
      createHandAuthoredConsumer({
        ...input,
        dependencySpecs: {
          '@bleedingdev/modern-js-ultramodern-app-tools': version,
        },
      }),
      /exact admitted/,
    );
  }
  await fs.mkdir(input.consumerRoot);
  await fs.writeFile(
    path.join(input.consumerRoot, 'preserve.txt'),
    'existing-owner',
  );
  await assert.rejects(createHandAuthoredConsumer(input), /EEXIST/);
  assert.equal(
    await fs.readFile(path.join(input.consumerRoot, 'preserve.txt'), 'utf8'),
    'existing-owner',
  );
});

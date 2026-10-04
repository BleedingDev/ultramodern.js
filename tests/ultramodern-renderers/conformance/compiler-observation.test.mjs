import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

// Public callback fixtures exercise the observer. They do not qualify an installed
// renderer, a native compilation, compiler plugin ownership or application output.
const observerFile = fileURLToPath(
  new URL('./fixtures/observe-native-compiler.ts', import.meta.url),
);
const receiptName = 'native-compiler-observation.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

async function fixture(t) {
  const temporary = await fs.mkdtemp(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'compiler-observation-',
    ),
  );
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const rootPath = await fs.realpath(temporary);
  const distPath = path.join(rootPath, 'output');
  await fs.mkdir(distPath);
  await fs.mkdir(path.join(rootPath, 'node_modules/.modern-js'), {
    recursive: true,
  });
  await fs.mkdir(path.join(rootPath, 'node_modules/unrelated'), {
    recursive: true,
  });
  await fs.copyFile(
    observerFile,
    path.join(rootPath, 'observe-native-compiler.ts'),
  );
  await Promise.all([
    fs.writeFile(
      path.join(rootPath, 'modern.config.ts'),
      'export default { source: { entry: {} } };\n',
    ),
    fs.writeFile(
      path.join(rootPath, 'authored.config.ts'),
      'export default {};\n',
    ),
    fs.writeFile(
      path.join(rootPath, 'node_modules/.modern-js/client.ts'),
      'export const client = true;\n',
    ),
    fs.writeFile(
      path.join(rootPath, 'node_modules/.modern-js/server.ts'),
      'export const server = true;\n',
    ),
    fs.writeFile(
      path.join(rootPath, 'node_modules/unrelated/never-inventory.ts'),
      'export const unrelated = true;\n',
    ),
  ]);
  const module = await import(
    pathToFileURL(path.join(rootPath, 'observe-native-compiler.ts')).href
  );
  let setupCalls = 0;
  const plugin = {
    name: 'fixture-configured-native-plugin',
    setup: () => {
      setupCalls++;
    },
  };
  const environments = {
    client: {
      name: 'client',
      entry: { csr: './node_modules/.modern-js/client.ts' },
      distPath,
      config: {
        mode: 'production',
        output: { target: 'web' },
        source: {
          entry: {
            csr: {
              import: ['./node_modules/.modern-js/client.ts'],
              html: true,
            },
          },
        },
        plugins: [plugin],
      },
    },
    server: {
      name: 'server',
      entry: { ssr: ['./node_modules/.modern-js/server.ts'] },
      distPath: path.join(distPath, 'server'),
      config: {
        mode: 'production',
        output: { target: 'node' },
        source: { entry: { ssr: './node_modules/.modern-js/server.ts' } },
        plugins: [],
      },
    },
  };
  const stats = {
    hasErrors: () => false,
    stats: Object.values(environments).map(environment => ({
      hasErrors: () => false,
      compilation: {
        name: environment.name,
        hash: `${environment.name}-actual-compilation-hash`,
        endTime: 1234,
        errors: [],
        entrypoints: new Map(
          Object.keys(environment.entry).map(name => [
            name,
            { getFiles: () => [`${name}.js`] },
          ]),
        ),
        getAsset: name => ({ name }),
        getAssets: () => [],
        outputOptions: { path: environment.distPath, publicPath: '/' },
        modules: new Set(
          Object.values(environment.entry).flatMap(description => {
            const roots =
              typeof description === 'string' ? [description] : description;
            return roots.map(root => {
              const resource = path.resolve(rootPath, root);
              return {
                identifier: () => resource,
                resource,
                resourceResolveData: { path: resource, resource },
              };
            });
          }),
        ),
        children: [],
      },
    })),
  };
  const context = {
    rootPath,
    distPath,
    version: '2.2.9',
    configFile: path.join(rootPath, 'modern.config.ts'),
    configFileDependencies: [path.join(rootPath, 'authored.config.ts')],
  };
  const normalized = { plugins: [false, [plugin], Promise.resolve(null)] };
  let descriptor;
  let developmentDescriptor;
  const observedPlugin = module.observeNativeCompiler();
  observedPlugin.setup({
    context,
    getNormalizedConfig: () => normalized,
    onAfterBuild: input => {
      descriptor = input;
    },
    onDevCompileDone: input => {
      developmentDescriptor = input;
    },
  });
  assert.equal(
    observedPlugin.name,
    'ultramodern-acceptance-observe-native-compiler',
  );
  assert.equal(observedPlugin.apply, undefined);
  assert.equal(descriptor.order, 'post');
  assert.equal(developmentDescriptor.order, 'post');
  const run = (overrides = {}) =>
    descriptor.handler({
      stats,
      environments,
      isFirstCompile: true,
      isWatch: false,
      ...overrides,
    });
  const receiptPath = path.join(distPath, receiptName);
  return {
    rootPath,
    distPath,
    context,
    normalized,
    environments,
    stats,
    run,
    receiptPath,
    setupCalls: () => setupCalls,
    developmentRun: (overrides = {}) =>
      developmentDescriptor.handler({
        stats,
        environments,
        isFirstCompile: true,
        ...overrides,
      }),
  };
}

async function developmentFixture(t, renderer = 'solid') {
  const input = await fixture(t);
  const serverRoot = path.join(
    input.rootPath,
    renderer === 'react'
      ? 'node_modules/.modern-js/ssr/index.server.jsx'
      : 'node_modules/.modern-js/native/index.server.ts',
  );
  await fs.mkdir(path.dirname(serverRoot));
  await fs.writeFile(serverRoot, 'export const nativeServer = true;\n');
  if (renderer !== 'react')
    await fs.writeFile(
      path.join(path.dirname(serverRoot), 'routes.server.ts'),
      'export const routeIR = [];\n',
    );
  input.environments.server.entry = { ssr: [serverRoot] };
  input.environments.server.config.source.entry = { ssr: serverRoot };
  input.stats.stats.find(
    result => result.compilation.name === 'server',
  ).compilation.modules = new Set([
    {
      identifier: () => serverRoot,
      resource: serverRoot,
      resourceResolveData: { path: serverRoot, resource: serverRoot },
    },
  ]);
  for (const environment of Object.values(input.environments))
    environment.config.mode = 'development';
  for (const result of input.stats.stats) {
    result.compilation.hash =
      result.compilation.name === 'client' ? 'a'.repeat(16) : 'b'.repeat(16);
    const emitted = new Set(
      [...result.compilation.entrypoints.values()].flatMap(entry =>
        entry.getFiles(),
      ),
    );
    result.compilation.getAsset = name =>
      emitted.has(name) ? { name } : undefined;
  }
  const developmentDirectory = path.join(input.distPath, '.ultramodern-dev');
  await fs.mkdir(developmentDirectory);
  const compilerRoot =
    renderer === 'react' ? input.distPath : developmentDirectory;
  input.context.distPath = compilerRoot;
  input.environments.client.distPath =
    renderer === 'react' ? compilerRoot : path.join(compilerRoot, 'client');
  input.environments.server.distPath = path.join(compilerRoot, 'bundles');
  for (const result of input.stats.stats)
    result.compilation.outputOptions.path =
      input.environments[result.compilation.name].distPath;
  const metadataFile = path.join(developmentDirectory, 'renderer-build.json');
  const devCompilation = {
    compilationHashes: Object.fromEntries(
      input.stats.stats.map(result => [
        result.compilation.name,
        result.compilation.hash,
      ]),
    ),
    generation: 1,
    sourceInputDigest: 'c'.repeat(64),
  };
  const metadata = {
    schema: 'ultramodern-renderer-build',
    version: 1,
    profile: { renderer },
    cacheAllowed: false,
    promotable: false,
    devCompilation,
  };
  const writeMetadata = (value = metadata) =>
    fs.writeFile(metadataFile, `${JSON.stringify(value)}\n`);
  return {
    ...input,
    serverRoot,
    developmentDirectory,
    metadataFile,
    metadata,
    devCompilation,
    writeMetadata,
    developmentReceiptPath: path.join(developmentDirectory, receiptName),
  };
}

test('observes every finalized module resource, including concatenated roots and child compilations', async t => {
  const input = await fixture(t);
  const client = input.stats.stats.find(
    result => result.compilation.name === 'client',
  ).compilation;
  const source = path.join(input.rootPath, 'route.data.ts');
  const childSource = path.join(input.rootPath, 'child.data.ts');
  await fs.writeFile(source, 'export const privateData = true;\n');
  await fs.writeFile(childSource, 'export const childData = true;\n');
  const root = {
    identifier: () => 'concatenated-root',
    resource: `${source}?raw#fragment`,
    resourceResolveData: { path: source, resource: `${source}?raw#fragment` },
  };
  client.modules.add({
    identifier: () => 'concatenated',
    rootModule: root,
    modules: [root],
  });
  client.modules.add({ identifier: () => 'webpack/runtime/publicPath' });
  client.modules.add({ identifier: () => 'external node:fs' });
  client.children.push({
    name: 'child',
    hash: 'actual-child-hash',
    modules: new Set([
      {
        identifier: () => 'child-resource',
        resource: childSource,
        resourceResolveData: { path: childSource, resource: childSource },
      },
    ]),
    children: [],
  });
  const before = [...client.modules];
  await input.run();
  assert.deepEqual(
    [...client.modules],
    before,
    'Observer must not mutate compiler modules',
  );
  const receipt = JSON.parse(await fs.readFile(input.receiptPath));
  const graph = receipt.environments.find(
    environment => environment.name === 'client',
  ).compiledModuleGraph;
  const { sha256: digest, ...value } = graph;
  assert.equal(digest, sha256(JSON.stringify(value)));
  const concat = graph.modules.find(
    module => module.identifier === 'concatenated',
  );
  assert.equal(
    concat.modules.length,
    1,
    'Same actual root object is retained once',
  );
  assert.equal(concat.modules[0].resource, `${source}?raw#fragment`);
  assert.deepEqual(concat.modules[0].source, {
    path: source,
    sha256: sha256(await fs.readFile(source)),
    size: (await fs.stat(source)).size,
  });
  assert.equal(graph.children[0].modules[0].source.path, childSource);
  assert.equal(
    graph.modules.find(
      module => module.identifier === 'webpack/runtime/publicPath',
    ).source,
    null,
  );
  assert.equal(
    graph.modules.find(module => module.identifier === 'external node:fs')
      .resource,
    null,
  );
});

test('captures actual startup and async CSS assets with public path, compiler hash and exact source bytes', async t => {
  const input = await fixture(t);
  const client = input.stats.stats.find(
    result => result.compilation.name === 'client',
  ).compilation;
  const sources = new Map([
    ['static/startup.css', Buffer.from('body { color: red; }\n')],
    ['static/lazy.css', Buffer.from('.lazy { color: blue; }\n')],
  ]);
  client.outputOptions.publicPath = '/acceptance-assets/';
  client.getAssets = () =>
    [...sources].map(([name, bytes]) => ({
      name,
      source: { source: () => bytes },
    }));
  client.entrypoints.get('csr').getFiles = () => [
    'csr.js',
    'static/startup.css',
  ];
  await input.run();
  const observation = JSON.parse(await fs.readFile(input.receiptPath));
  const css = observation.environments.find(
    value => value.name === 'client',
  ).compiledStylesheets;
  assert.equal(css.evidence, 'stats.compilation.getAssets');
  assert.equal(css.compilationHash, client.hash);
  assert.equal(css.outputPath, input.distPath);
  assert.equal(css.publicPath, '/acceptance-assets/');
  assert.deepEqual(css.startupFiles, { csr: ['static/startup.css'] });
  assert.deepEqual(
    css.assets.map(value => value.file),
    ['static/lazy.css', 'static/startup.css'],
  );
  for (const asset of css.assets) {
    assert.deepEqual(asset.source, {
      encoding: 'utf8',
      bytes: sources.get(asset.file).toString('utf8'),
    });
    assert.equal(asset.sha256, sha256(sources.get(asset.file)));
    assert.equal(asset.size, sources.get(asset.file).byteLength);
  }
  const { sha256: digest, ...value } = css;
  assert.equal(digest, sha256(JSON.stringify(value)));
  assert.equal(
    Object.hasOwn(
      observation.environments.find(value => value.name === 'server'),
      'compiledStylesheets',
    ),
    false,
  );
});

test('retains an async CSS closure with empty startup CSS and lossless non-UTF8 source bytes', async t => {
  const input = await developmentFixture(t);
  await input.writeMetadata();
  const client = input.stats.stats.find(
    result => result.compilation.name === 'client',
  ).compilation;
  const bytes = Buffer.from([0xff, 0xfe, 0x2e, 0x7b, 0x7d]);
  client.outputOptions.publicPath = 'auto';
  client.getAssets = () => [
    { name: 'async.css', source: { source: () => bytes } },
  ];
  await input.developmentRun();
  const observation = JSON.parse(
    await fs.readFile(input.developmentReceiptPath),
  );
  const css = observation.environments.find(
    value => value.name === 'client',
  ).compiledStylesheets;
  assert.equal(css.publicPath, 'auto');
  assert.deepEqual(css.startupFiles, { csr: [] });
  assert.deepEqual(css.assets, [
    {
      file: 'async.css',
      sha256: sha256(bytes),
      size: bytes.byteLength,
      source: { encoding: 'base64', bytes: bytes.toString('base64') },
    },
  ]);
  assert.equal(
    await fs.stat(path.join(input.distPath, 'async.css')).catch(() => null),
    null,
  );
});

test('rejects absent startup CSS assets and CSS bytes, public path or hash mutation during capture', async t => {
  const missing = await fixture(t);
  missing.stats.stats
    .find(result => result.compilation.name === 'client')
    .compilation.entrypoints.get('csr').getFiles = () => [
    'csr.js',
    'missing.css',
  ];
  await assert.rejects(missing.run(), /startup CSS.*absent/u);
  for (const mutate of [
    client => {
      client.hash = 'changed-stats-hash';
    },
    client => {
      client.outputOptions.publicPath = '/changed/';
    },
    (client, source) => {
      source.bytes = Buffer.from('changed CSS');
    },
  ]) {
    const input = await fixture(t);
    const client = input.stats.stats.find(
      result => result.compilation.name === 'client',
    ).compilation;
    const source = { bytes: Buffer.from('.lazy {}\n') };
    client.getAssets = () => [
      { name: 'lazy.css', source: { source: () => source.bytes } },
    ];
    const module = [...client.modules][0];
    const identify = module.identifier;
    let calls = 0;
    module.identifier = () => {
      if (++calls === 2) mutate(client, source);
      return identify();
    };
    await assert.rejects(input.run(), /stylesheet closure changed/u);
    assert.equal(await fs.stat(input.receiptPath).catch(() => null), null);
  }
});

test('fails closed on absent, unresolved or changing finalized module graphs', async t => {
  const input = await fixture(t);
  const client = input.stats.stats.find(
    result => result.compilation.name === 'client',
  ).compilation;
  const original = client.modules;
  client.modules = undefined;
  await assert.rejects(input.run(), /complete module graph/u);
  client.modules = new Set([
    {
      identifier: () => 'missing',
      resource: path.join(input.rootPath, 'missing.data.ts'),
      resourceResolveData: {
        path: path.join(input.rootPath, 'missing.data.ts'),
        resource: path.join(input.rootPath, 'missing.data.ts'),
      },
    },
  ]);
  await assert.rejects(input.run(), /ENOENT/u);
  let calls = 0;
  const actual = path.join(input.rootPath, 'node_modules/.modern-js/client.ts');
  client.modules = new Set([
    {
      identifier: () => (++calls === 1 ? 'initial' : 'changed'),
      resource: actual,
      resourceResolveData: { path: actual, resource: actual },
    },
  ]);
  await assert.rejects(input.run(), /module graph changed/u);
  client.modules = original;
  assert.equal(await fs.stat(input.receiptPath).catch(() => null), null);
});

test('preserves data URI modules and uses actual resolver paths for escaped filename characters', async t => {
  const input = await fixture(t);
  const client = input.stats.stats.find(
    result => result.compilation.name === 'client',
  ).compilation;
  const source = path.join(input.rootPath, 'literal?#.ts');
  await fs.writeFile(source, 'export const literal = true;\n');
  const resource =
    source.replace(/[?#]/gu, character => `\0${character}`) + '?raw#fragment';
  const data = 'data:text/javascript,export%20const%20inline%20%3D%20true';
  client.modules.add({
    identifier: () => 'literal-resource',
    resource,
    resourceResolveData: { path: source, resource },
  });
  client.modules.add({ identifier: () => 'data-uri-resource', resource: data });
  await input.run();
  const graph = JSON.parse(
    await fs.readFile(input.receiptPath),
  ).environments.find(
    environment => environment.name === 'client',
  ).compiledModuleGraph;
  assert.equal(
    graph.modules.find(module => module.identifier === 'literal-resource')
      .source.path,
    source,
  );
  assert.deepEqual(
    graph.modules.find(module => module.identifier === 'data-uri-resource'),
    {
      identifier: 'data-uri-resource',
      resource: data,
      source: null,
      modules: [],
    },
  );
});

test('rejects source mutation while the completed graph is being pinned', async t => {
  const input = await fixture(t);
  const client = input.stats.stats.find(
    result => result.compilation.name === 'client',
  ).compilation;
  const source = path.join(input.rootPath, 'node_modules/.modern-js/client.ts');
  let calls = 0;
  client.modules = new Set([
    {
      identifier: () => {
        if (++calls === 2)
          writeFileSync(source, 'export const changedAfterCapture = true;\n');
        return 'same-module';
      },
      resource: source,
      resourceResolveData: { path: source, resource: source },
    },
  ]);
  await assert.rejects(input.run(), /module source changed/u);
  assert.equal(await fs.stat(input.receiptPath).catch(() => null), null);
});

test('observes the genuine dev callback wave without overwriting the production receipt', async t => {
  const input = await developmentFixture(t);
  await fs.writeFile(input.receiptPath, 'production receipt stays pinned\n');
  await input.writeMetadata();
  const before = JSON.stringify([input.environments, input.metadata]);
  await input.developmentRun();
  assert.equal(JSON.stringify([input.environments, input.metadata]), before);
  assert.equal(
    await fs.readFile(input.receiptPath, 'utf8'),
    'production receipt stays pinned\n',
  );
  const bytes = await fs.readFile(input.developmentReceiptPath);
  const observation = JSON.parse(bytes);
  assert.equal(observation.observer.event, 'onDevCompileDone');
  assert.equal(observation.observer.order, 'post');
  assert.deepEqual(observation.development, {
    metadataFile: input.metadataFile,
    metadataSha256: sha256(await fs.readFile(input.metadataFile)),
    devCompilation: input.devCompilation,
  });
  assert.ok(
    observation.environments.every(value => value.mode === 'development'),
  );
  assert.deepEqual(
    observation.environments.map(value => value.nativeModuleManifests),
    [[], []],
  );
  assert.ok(
    observation.sourceInventory.some(
      value =>
        value.path ===
          path
            .relative(input.rootPath, input.metadataFile)
            .split(path.sep)
            .join('/') && value.roles.includes('development-manifest'),
    ),
  );
  assert.ok(
    observation.sourceInventory.some(
      value =>
        value.path.endsWith('/routes.server.ts') &&
        value.roles.includes('environment:server:route-ir'),
    ),
  );
  assert.equal(
    await fs.readFile(`${input.developmentReceiptPath}.sha256`, 'utf8'),
    `${sha256(bytes)}\n`,
  );
});

test('observes React development server roots without assuming native route IR filenames', async t => {
  const input = await developmentFixture(t, 'react');
  const dataSource = path.join(input.rootPath, 'route.data.ts');
  await fs.writeFile(
    dataSource,
    'export const loader = () => "server-only";\n',
  );
  input.stats.stats
    .find(result => result.compilation.name === 'server')
    .compilation.modules.add({
      identifier: () => dataSource,
      resource: dataSource,
      resourceResolveData: { path: dataSource, resource: dataSource },
    });
  await input.writeMetadata();
  await input.developmentRun();
  const bytes = await fs.readFile(input.developmentReceiptPath);
  const observation = JSON.parse(bytes);
  const server = observation.environments.find(
    value => value.name === 'server',
  );
  assert.deepEqual(server.entry, { ssr: [input.serverRoot] });
  assert.deepEqual(
    server.compiledModuleGraph.modules.map(value => value.source),
    [
      {
        path: input.serverRoot,
        sha256: sha256(await fs.readFile(input.serverRoot)),
        size: (await fs.stat(input.serverRoot)).size,
      },
      {
        path: dataSource,
        sha256: sha256(await fs.readFile(dataSource)),
        size: (await fs.stat(dataSource)).size,
      },
    ],
  );
  assert.equal(
    observation.sourceInventory.some(value =>
      value.roles.includes('environment:server:route-ir'),
    ),
    false,
  );
  assert.equal(
    observation.environments
      .find(value => value.name === 'client')
      .compiledModuleGraph.modules.some(value => value.resource === dataSource),
    false,
  );
  assert.equal(
    await fs.readFile(`${input.developmentReceiptPath}.sha256`, 'utf8'),
    `${sha256(bytes)}\n`,
  );
});

for (const renderer of ['solid', 'octane'])
  test(`observes ${renderer} at the actual relocated native development output root`, async t => {
    const input = await developmentFixture(t, renderer);
    await input.writeMetadata();
    assert.equal(input.context.distPath, input.developmentDirectory);
    await input.developmentRun();
    const observation = JSON.parse(
      await fs.readFile(input.developmentReceiptPath, 'utf8'),
    );
    assert.equal(observation.distPath, input.distPath);
    assert.equal(observation.development.metadataFile, input.metadataFile);
    assert.equal(
      observation.development.metadataSha256,
      sha256(await fs.readFile(input.metadataFile)),
    );
    assert.equal(
      await fs
        .stat(path.join(input.developmentDirectory, '.ultramodern-dev'))
        .catch(() => null),
      null,
    );
  });

test('rejects a development compiler output disagreement without writing an observation', async t => {
  const input = await developmentFixture(t);
  await input.writeMetadata();
  input.stats.stats.find(
    result => result.compilation.name === 'server',
  ).compilation.outputOptions.path = path.join(input.distPath, 'bundles');
  await assert.rejects(
    input.developmentRun(),
    /actual owning compiler output layout/u,
  );
  assert.equal(
    await fs.stat(input.developmentReceiptPath).catch(() => null),
    null,
  );
});

test('rejects a renderer that disagrees with its development compiler output layout', async t => {
  const input = await developmentFixture(t);
  await input.writeMetadata({
    ...input.metadata,
    profile: { renderer: 'react' },
  });
  await assert.rejects(input.developmentRun(), /renderer disagrees/u);
  assert.equal(
    await fs.stat(input.developmentReceiptPath).catch(() => null),
    null,
  );
});

test('uses the installed Rsbuild 2.2.9 awaited pre/default/post semantics for the direct dev hook', async t => {
  const input = await developmentFixture(t);
  const sdkRoot = fileURLToPath(
    new URL(
      '../../../packages/cli/builder/node_modules/@rsbuild/core/',
      import.meta.url,
    ),
  );
  assert.equal(
    JSON.parse(await fs.readFile(path.join(sdkRoot, 'package.json'), 'utf8'))
      .version,
    '2.2.9',
  );
  const source = await fs.readFile(path.join(sdkRoot, 'dist/m.js'), 'utf8');
  assert.match(source, /onDevCompileDone:\s*hooks\.onAfterDevCompile\.tap/u);
  assert.match(source, /context\.hooks\.onAfterDevCompile\.callBatch/u);
  const start = source.indexOf('function createAsyncHook() {');
  const end = source.indexOf('\nfunction initHooks()', start);
  assert.ok(start >= 0 && end > start);
  const hook = runInNewContext(
    `${source.slice(start, end)}\ncreateAsyncHook()`,
    { isFunction: value => typeof value === 'function' },
  );
  let releasePublisher;
  const publisherLatch = new Promise(resolve => {
    releasePublisher = resolve;
  });
  const calls = [];
  hook.tap({
    order: 'post',
    handler: async () => {
      calls.push('observer');
      await input.developmentRun();
    },
  });
  hook.tap(() => {
    calls.push('cli-forwarding');
  });
  hook.tap({
    order: 'pre',
    handler: async () => {
      calls.push('native-publisher-start');
      await publisherLatch;
      await input.writeMetadata();
      calls.push('native-publisher-committed');
    },
  });
  const completion = hook.callBatch({});
  await Promise.resolve();
  assert.deepEqual(calls, ['native-publisher-start']);
  assert.equal(
    await fs.stat(input.developmentReceiptPath).catch(() => null),
    null,
  );
  releasePublisher();
  await completion;
  assert.deepEqual(calls, [
    'native-publisher-start',
    'native-publisher-committed',
    'cli-forwarding',
    'observer',
  ]);
  assert.equal(
    JSON.parse(await fs.readFile(input.developmentReceiptPath, 'utf8'))
      .development.devCompilation.generation,
    1,
  );
});

test('dev observation fails closed on absent, stale, malformed or promoted wave metadata', async t => {
  const input = await developmentFixture(t);
  await assert.rejects(input.developmentRun(), /ENOENT/u);
  for (const metadata of [
    { ...input.metadata, cacheAllowed: true },
    { ...input.metadata, promotable: true },
    {
      ...input.metadata,
      devCompilation: { ...input.devCompilation, generation: 0 },
    },
    {
      ...input.metadata,
      devCompilation: { ...input.devCompilation, sourceInputDigest: 'bad' },
    },
    {
      ...input.metadata,
      devCompilation: { ...input.devCompilation, ignored: true },
    },
    {
      ...input.metadata,
      devCompilation: {
        ...input.devCompilation,
        compilationHashes: { client: 'd'.repeat(16), server: 'b'.repeat(16) },
      },
    },
    {
      ...input.metadata,
      devCompilation: {
        ...input.devCompilation,
        compilationHashes: {
          ...input.devCompilation.compilationHashes,
          unseen: 'd'.repeat(16),
        },
      },
    },
  ]) {
    await input.writeMetadata(metadata);
    await assert.rejects(input.developmentRun(), /Development observation/u);
  }
  assert.equal(
    await fs.stat(input.developmentReceiptPath).catch(() => null),
    null,
  );
});

test('dev callback rejects production stats and missing actual regenerated server route IR', async t => {
  const input = await developmentFixture(t);
  await input.writeMetadata();
  input.environments.server.config.mode = 'production';
  await assert.rejects(input.developmentRun(), /mode.*lifecycle/u);
  input.environments.server.config.mode = 'development';
  await fs.rm(path.join(path.dirname(input.serverRoot), 'routes.server.ts'));
  await assert.rejects(input.developmentRun(), /ENOENT/u);
  assert.equal(
    await fs.stat(input.developmentReceiptPath).catch(() => null),
    null,
  );
});

test('dev callback captures actual memory native module manifests and checks their emitted file ownership', async t => {
  const input = await developmentFixture(t);
  await input.writeMetadata();
  const client = input.stats.stats.find(
    value => value.compilation.name === 'client',
  ).compilation;
  const manifestName = 'solid-module-manifest.csr.json';
  const nativeSource = JSON.stringify({
    modules: { _base: '/', opaque: { file: 'native-lazy.js' } },
  });
  const assets = new Map([
    ['csr.js', { name: 'csr.js' }],
    ['native-lazy.js', { name: 'native-lazy.js' }],
    [
      manifestName,
      {
        name: manifestName,
        source: { source: () => Buffer.from(nativeSource) },
      },
    ],
  ]);
  client.getAsset = name => assets.get(name);
  await input.developmentRun();
  const observation = JSON.parse(
    await fs.readFile(input.developmentReceiptPath, 'utf8'),
  );
  assert.deepEqual(
    observation.environments.find(value => value.name === 'client')
      .nativeModuleManifests,
    [
      {
        file: manifestName,
        source: nativeSource,
        sha256: sha256(nativeSource),
        size: Buffer.byteLength(nativeSource),
      },
    ],
  );
  assets.delete('native-lazy.js');
  await assert.rejects(input.developmentRun(), /absent actual compiler asset/u);
});

test('captures actual final roots and completed entrypoints without changing config or applying plugins', async t => {
  const input = await fixture(t);
  freeze(input.context);
  freeze(input.environments);
  freeze(input.normalized);
  const before = JSON.stringify([
    input.context,
    input.environments,
    input.normalized,
  ]);
  await input.run();
  assert.equal(
    JSON.stringify([input.context, input.environments, input.normalized]),
    before,
  );
  assert.equal(input.setupCalls(), 0);
  const bytes = await fs.readFile(input.receiptPath);
  assert.equal(
    await fs.readFile(`${input.receiptPath}.sha256`, 'utf8'),
    `${sha256(bytes)}\n`,
  );
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.schema, 'ultramodern-native-compiler-observation');
  assert.equal(receipt.version, 1);
  assert.deepEqual(receipt.observer, {
    event: 'onAfterBuild',
    order: 'post',
    rsbuildVersion: '2.2.9',
    sourceFile: path.join(input.rootPath, 'observe-native-compiler.ts'),
  });
  assert.equal(receipt.rootPath, input.rootPath);
  assert.equal(receipt.distPath, input.distPath);
  assert.equal(receipt.configFile, input.context.configFile);
  assert.deepEqual(receipt.configuredPlugins, {
    evidence: 'api.getNormalizedConfig().plugins',
    names: ['fixture-configured-native-plugin'],
    plugins: [
      { name: 'fixture-configured-native-plugin', configuredClaim: null },
    ],
    appliedOwnership: 'unavailable-public-api',
  });
  assert.deepEqual(
    receipt.environments.map(environment => ({
      name: environment.name,
      target: environment.target,
      entry: environment.entry,
      configSourceEntry: environment.configSourceEntry,
      names: environment.compiledEntryNames,
      hash: environment.compilationHash,
      errors: environment.errorCount,
    })),
    [
      {
        name: 'client',
        target: 'web',
        entry: { csr: ['./node_modules/.modern-js/client.ts'] },
        configSourceEntry: { csr: ['./node_modules/.modern-js/client.ts'] },
        names: ['csr'],
        hash: 'client-actual-compilation-hash',
        errors: 0,
      },
      {
        name: 'server',
        target: 'node',
        entry: { ssr: ['./node_modules/.modern-js/server.ts'] },
        configSourceEntry: { ssr: ['./node_modules/.modern-js/server.ts'] },
        names: ['ssr'],
        hash: 'server-actual-compilation-hash',
        errors: 0,
      },
    ],
  );
  assert.deepEqual(
    receipt.sourceInventory.map(source => source.path),
    [
      'authored.config.ts',
      'modern.config.ts',
      'node_modules/.modern-js/client.ts',
      'node_modules/.modern-js/server.ts',
      'observe-native-compiler.ts',
    ],
  );
  assert.deepEqual(
    receipt.environments.map(environment => environment.compiledEntryFiles),
    [{ csr: ['csr.js'] }, { ssr: ['ssr.js'] }],
  );
  for (const source of receipt.sourceInventory) {
    const actual = await fs.readFile(path.join(input.rootPath, source.path));
    assert.equal(source.sha256, sha256(actual));
    assert.equal(source.size, actual.byteLength);
  }
  assert.deepEqual(
    receipt.sourceInventory.find(
      source => source.path === 'observe-native-compiler.ts',
    ).roles,
    ['executing-observer', 'fixture-observer'],
  );
  assert.deepEqual(await fs.readdir(input.distPath), [
    receiptName,
    `${receiptName}.sha256`,
  ]);
});

test('records absent SDK config authority while hashing the actual authored fixture config', async t => {
  const input = await fixture(t);
  delete input.context.configFile;
  input.context.configFileDependencies = [];
  await input.run();
  const receipt = JSON.parse(await fs.readFile(input.receiptPath, 'utf8'));
  assert.equal(receipt.configFile, null);
  assert.deepEqual(receipt.configFileDependencies, []);
  assert.deepEqual(
    receipt.sourceInventory.find(source => source.path === 'modern.config.ts')
      .roles,
    ['fixture-config'],
  );
});

test('observes an existing own compiler claim without inventing applied ownership', async t => {
  const input = await fixture(t);
  const plugin = input.environments.client.config.plugins[0];
  plugin[Symbol.for('ultramodern.renderer-compiler-claim')] = {
    renderer: 'solid',
    sourceExtensions: ['.tsx', '.jsx'],
    transform: 'native',
    refresh: 'native',
    svg: 'url',
  };
  await input.run();
  const receipt = JSON.parse(await fs.readFile(input.receiptPath, 'utf8'));
  assert.deepEqual(
    receipt.configuredPlugins.plugins[0].configuredClaim,
    plugin[Symbol.for('ultramodern.renderer-compiler-claim')],
  );
  assert.deepEqual(
    receipt.environments[0].configuredPlugins.plugins[0].configuredClaim,
    plugin[Symbol.for('ultramodern.renderer-compiler-claim')],
  );
  assert.equal(
    receipt.configuredPlugins.appliedOwnership,
    'unavailable-public-api',
  );
  assert.equal(input.setupCalls(), 0);
});

test('does not execute inherited or accessor compiler claims', async t => {
  const input = await fixture(t);
  let calls = 0;
  Object.defineProperty(
    input.environments.client.config.plugins[0],
    Symbol.for('ultramodern.renderer-compiler-claim'),
    {
      enumerable: true,
      get() {
        calls++;
        throw new Error('must not run claim getter');
      },
    },
  );
  await input.run();
  const receipt = JSON.parse(await fs.readFile(input.receiptPath, 'utf8'));
  assert.equal(receipt.configuredPlugins.plugins[0].configuredClaim, null);
  assert.equal(calls, 0);
  const inherited = Object.create({
    [Symbol.for('ultramodern.renderer-compiler-claim')]: {
      renderer: 'foreign',
      sourceExtensions: ['.tsx'],
      transform: 'native',
      refresh: 'native',
      svg: 'url',
    },
  });
  inherited.name = 'fixture-inherited-claim';
  input.normalized.plugins = [inherited];
  await input.run();
  const next = JSON.parse(await fs.readFile(input.receiptPath, 'utf8'));
  assert.deepEqual(next.configuredPlugins.plugins, [
    { name: 'fixture-inherited-claim', configuredClaim: null },
  ]);
});

test('rejects unavailable compiler stats and a missing server environment', async t => {
  const input = await fixture(t);
  await assert.rejects(input.run({ stats: undefined }), /successful completed/);
  delete input.environments.server;
  await assert.rejects(input.run(), /client and server environments/);
  assert.deepEqual(await fs.readdir(input.distPath), []);
});

test('records differing observed entry maps without claiming root to compilation equivalence', async t => {
  const input = await fixture(t);
  input.environments.client.config.source.entry = {
    authored: './authored.config.ts',
  };
  await input.run();
  const receipt = JSON.parse(await fs.readFile(input.receiptPath, 'utf8'));
  assert.deepEqual(receipt.environments[0].entry, {
    csr: ['./node_modules/.modern-js/client.ts'],
  });
  assert.deepEqual(receipt.environments[0].configSourceEntry, {
    authored: ['./authored.config.ts'],
  });
  assert.deepEqual(receipt.environments[0].compiledEntryNames, ['csr']);
});

test('records every auxiliary compiled entry and its exact emitted files without guessing names', async t => {
  const input = await fixture(t);
  const compilation = input.stats.stats[0].compilation;
  const files = [
    'assets/runtime.js',
    'assets/opaque-facade.js',
    'assets/facade.css',
  ];
  compilation.entrypoints.set('opaque-compiler-owned-entry', {
    getFiles: () => files,
  });
  compilation.getAssets = () => [
    { name: 'assets/facade.css', source: { source: () => '.facade {}\n' } },
  ];
  await input.run();
  const receipt = JSON.parse(await fs.readFile(input.receiptPath, 'utf8'));
  assert.deepEqual(receipt.environments[0].compiledEntryNames, [
    'csr',
    'opaque-compiler-owned-entry',
  ]);
  assert.deepEqual(receipt.environments[0].compiledEntryFiles, {
    csr: ['csr.js'],
    'opaque-compiler-owned-entry': files,
  });
});

test('rejects malformed configured claims instead of dropping their evidence', async t => {
  const input = await fixture(t);
  input.environments.client.config.plugins[0][
    Symbol.for('ultramodern.renderer-compiler-claim')
  ] = { renderer: 'solid' };
  await assert.rejects(input.run(), /invalid configured claim/);
  assert.deepEqual(await fs.readdir(input.distPath), []);
});

for (const [name, mutate, message] of [
  [
    'failed aggregate stats',
    input => {
      input.stats.hasErrors = () => true;
    },
    /successful completed/,
  ],
  [
    'failed child stats',
    input => {
      input.stats.stats[0].hasErrors = () => true;
    },
    /successful completed client/,
  ],
  [
    'actual compilation errors',
    input => {
      input.stats.stats[0].compilation.errors.push(new Error('compiler error'));
    },
    /successful completed client/,
  ],
  [
    'buffered compilation hash',
    input => {
      input.stats.stats[0].compilation.hash = undefined;
    },
    /successful completed client/,
  ],
  [
    'unfinished compilation',
    input => {
      input.stats.stats[0].compilation.endTime = undefined;
    },
    /successful completed client/,
  ],
  [
    'missing compiled roots',
    input => {
      input.stats.stats[0].compilation.entrypoints.clear();
    },
    /compiled entrypoints/,
  ],
  [
    'unemitted entrypoint files',
    input => {
      input.stats.stats[0].compilation.getAsset = () => undefined;
    },
    /actual emitted files/,
  ],
  [
    'duplicate compilation names',
    input => {
      input.stats.stats.push(input.stats.stats[0]);
    },
    /one actual compilation/,
  ],
  [
    'unmatched compilation',
    input => {
      input.stats.stats.push({
        hasErrors: () => false,
        compilation: { name: 'foreign' },
      });
    },
    /unmatched compilation/,
  ],
  [
    'missing config source entries',
    input => {
      delete input.environments.client.config.source.entry;
    },
    /final source entry maps/,
  ],
  [
    'non-file entry syntax',
    input => {
      input.environments.client.entry.csr =
        'loader!./node_modules/.modern-js/client.ts';
    },
    /ENOENT/,
  ],
]) {
  test(`rejects ${name} before writing a receipt`, async t => {
    const input = await fixture(t);
    mutate(input);
    await assert.rejects(input.run(), message);
    assert.deepEqual(await fs.readdir(input.distPath), []);
  });
}

test('rejects entry roots outside the actual consumer', async t => {
  const input = await fixture(t);
  input.environments.client.entry.csr = '../foreign.ts';
  await assert.rejects(input.run(), /inside its consumer/);
  assert.deepEqual(await fs.readdir(input.distPath), []);
});

test('rejects SDK config dependencies outside the actual consumer', async t => {
  const input = await fixture(t);
  input.context.configFileDependencies = ['../foreign.config.ts'];
  await assert.rejects(input.run(), /inside its consumer/);
  assert.deepEqual(await fs.readdir(input.distPath), []);
});

test('rejects entry symlinks that escape the actual consumer', async t => {
  const input = await fixture(t);
  const external = await fs.mkdtemp(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'compiler-observation-external-',
    ),
  );
  t.after(() => fs.rm(external, { recursive: true, force: true }));
  const target = path.join(external, 'foreign.ts');
  await fs.writeFile(target, 'export default false;\n');
  await fs.symlink(target, path.join(input.rootPath, 'foreign.ts'));
  input.environments.client.entry.csr = './foreign.ts';
  await assert.rejects(input.run(), /inside its consumer/);
  assert.deepEqual(await fs.readdir(input.distPath), []);
});

test('atomically replaces its receipt and exact-byte digest without leaving temporary files', async t => {
  const input = await fixture(t);
  await input.run();
  const first = await fs.readFile(input.receiptPath);
  input.stats.stats[0].compilation.hash = 'later-actual-compilation-hash';
  await input.run();
  const second = await fs.readFile(input.receiptPath);
  assert.notDeepEqual(first, second);
  assert.equal(
    await fs.readFile(`${input.receiptPath}.sha256`, 'utf8'),
    `${sha256(second)}\n`,
  );
  assert.deepEqual(await fs.readdir(input.distPath), [
    receiptName,
    `${receiptName}.sha256`,
  ]);
});

test('retains prior evidence when reading a current source fails', async t => {
  const input = await fixture(t);
  await input.run();
  const receipt = await fs.readFile(input.receiptPath);
  const digest = await fs.readFile(`${input.receiptPath}.sha256`);
  await fs.rm(path.join(input.rootPath, 'node_modules/.modern-js/client.ts'));
  await assert.rejects(input.run(), /ENOENT/);
  assert.deepEqual(await fs.readFile(input.receiptPath), receipt);
  assert.deepEqual(await fs.readFile(`${input.receiptPath}.sha256`), digest);
  assert.deepEqual(await fs.readdir(input.distPath), [
    receiptName,
    `${receiptName}.sha256`,
  ]);
});

test('cleans only owned temporary files when replacing the receipt fails', async t => {
  const input = await fixture(t);
  await fs.mkdir(input.receiptPath);
  await assert.rejects(input.run(), /EISDIR|ENOTEMPTY|EPERM/);
  assert.deepEqual(await fs.readdir(input.distPath), [receiptName]);
  assert.equal((await fs.stat(input.receiptPath)).isDirectory(), true);
});

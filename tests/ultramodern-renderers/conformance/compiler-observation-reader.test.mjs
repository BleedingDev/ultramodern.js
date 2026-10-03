import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertNativeCompilerObservationUnchanged,
  assertNativeTypeProgramBindings,
  readCompiledClientModuleGraph,
  readNativeCompilerObservation,
} from '../../../scripts/ultramodern-renderers/acceptance/compiler-observation.mjs';

// Real files and authenticated fake receipts exercise the acceptance reader.
// They do not qualify a native build, an installed compiler or application output.
const observerSource = fileURLToPath(
  new URL('./fixtures/observe-native-compiler.ts', import.meta.url),
);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const entryNames = ['csr', 'ssr'];

function sealModuleGraph(graph) {
  const { evidence, name, compilationHash, modules, children } = graph;
  graph.sha256 = sha256(
    JSON.stringify({ evidence, name, compilationHash, modules, children }),
  );
  return graph;
}

function sealStylesheets(stylesheets) {
  const {
    evidence,
    compilationHash,
    outputPath,
    publicPath,
    assets,
    startupFiles,
  } = stylesheets;
  stylesheets.sha256 = sha256(
    JSON.stringify({
      evidence,
      compilationHash,
      outputPath,
      publicPath,
      assets,
      startupFiles,
    }),
  );
  return stylesheets;
}

async function compiledSource(file) {
  const canonical = await fs.realpath(file);
  const bytes = await fs.readFile(canonical);
  return { path: canonical, sha256: sha256(bytes), size: bytes.byteLength };
}

function plugins(renderer, evidence, selected = true) {
  const entries = selected
    ? [
        {
          name: `ultramodern:${renderer}:compiler`,
          configuredClaim: {
            renderer,
            sourceExtensions:
              renderer === 'solid'
                ? ['.jsx', '.tsx', '.js', '.ts']
                : ['.tsrx', '.tsx', '.jsx', '.ts', '.js'],
            transform: 'native',
            refresh: 'native',
            svg: 'url',
          },
        },
      ]
    : [];
  return {
    evidence,
    names: entries.map(plugin => plugin.name),
    plugins: entries,
    appliedOwnership: 'unavailable-public-api',
  };
}

async function fixture(
  t,
  renderer = 'solid',
  environment = 'production',
  { nestedApplication = false } = {},
) {
  const temporary = await fs.mkdtemp(
    path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'compiler-reader-'),
  );
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const workspaceRoot = await fs.realpath(temporary);
  const applicationDirectory = nestedApplication
    ? path.join(workspaceRoot, 'application')
    : workspaceRoot;
  await fs.mkdir(applicationDirectory, { recursive: true });
  const applicationRoot = await fs.realpath(applicationDirectory);
  const distDirectory = path.join(applicationRoot, 'dist');
  const receiptPath = path.join(
    distDirectory,
    ...(environment === 'development' ? ['.ultramodern-dev'] : []),
    'native-compiler-observation.json',
  );
  await fs.mkdir(path.join(distDirectory, 'server'), { recursive: true });
  const sourceRoles = new Map();
  const addFile = async (relative, content, roles) => {
    const target = path.join(applicationRoot, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
    sourceRoles.set(relative, roles);
    return target;
  };
  await addFile('modern.config.ts', 'export default {};\n', ['fixture-config']);
  await addFile('authored.config.ts', 'export const authored = true;\n', [
    'sdk-config-dependency',
  ]);
  await addFile(
    'observe-native-compiler.ts',
    await fs.readFile(observerSource),
    ['executing-observer', 'fixture-observer'],
  );
  const nativeTypeEntries = { browser: [], server: [] };
  const environments = [];
  for (const [name, role, basename, target] of [
    ['client', 'browser', 'index.ts', 'web'],
    ['server', 'server', 'index.server.ts', 'node'],
  ]) {
    const entry = {};
    for (const entryName of entryNames) {
      const relative =
        renderer === 'react'
          ? `node_modules/.modern-js/${entryName}/${basename}`
          : `node_modules/.modern-js/${renderer}/${entryName}/${basename}`;
      const absolute = await addFile(
        relative,
        `export const entry = ${JSON.stringify(`${entryName}:${role}`)};\n`,
        [
          `environment:${name}:config-source-entry`,
          `environment:${name}:entry`,
        ],
      );
      nativeTypeEntries[role].push(absolute);
      entry[entryName] = [absolute];
      if (environment === 'development' && role === 'server')
        await addFile(
          path.posix.join(path.posix.dirname(relative), 'routes.server.ts'),
          'export const routeIR = [];\nexport const routeModules = {};\n',
          ['environment:server:route-ir'],
        );
    }
    environments.push({
      name,
      target,
      mode: environment,
      distPath:
        name === 'client' ? distDirectory : path.join(distDirectory, 'server'),
      entry,
      configSourceEntry: structuredClone(entry),
      compiledEntryNames: [...entryNames],
      compiledEntryFiles: Object.fromEntries(
        entryNames.map(entryName => [entryName, [`${entryName}.js`]]),
      ),
      compilationHash:
        environment === 'development'
          ? name === 'client'
            ? '12ab'
            : '34cd'
          : `${name}-completed-hash`,
      hasErrors: false,
      errorCount: 0,
      configuredPlugins: plugins(renderer, 'environment.config.plugins', false),
    });
    for (const entryName of entryNames)
      await fs.writeFile(
        path.join(
          name === 'client'
            ? distDirectory
            : path.join(distDirectory, 'server'),
          `${entryName}.js`,
        ),
        `export const compiledEntry = ${JSON.stringify(`${name}:${entryName}`)};\n`,
      );
  }
  const startup = await addFile(
    'src/startup.ts',
    'export const startup = true;\n',
    ['environment:client:config-source-entry', 'environment:client:entry'],
  );
  environments[0].entry.csr.push(startup);
  environments[0].configSourceEntry.csr.push(startup);
  for (const item of environments)
    item.compiledModuleGraph = sealModuleGraph({
      evidence: 'stats.compilation.modules',
      name: item.name,
      compilationHash: item.compilationHash,
      modules: await Promise.all(
        [...new Set(Object.values(item.entry).flat())].map(async file => ({
          identifier: file,
          resource: file,
          source: await compiledSource(file),
          modules: [],
        })),
      ),
      children: [],
    });
  environments[0].compiledStylesheets = sealStylesheets({
    evidence: 'stats.compilation.getAssets',
    compilationHash: environments[0].compilationHash,
    outputPath: environments[0].distPath,
    publicPath: '',
    assets: [],
    startupFiles: Object.fromEntries(
      environments[0].compiledEntryNames.map(name => [name, []]),
    ),
  });
  let developmentManifest;
  let developmentMetadataFile;
  let development;
  if (environment === 'development') {
    const buildMarker = 'a'.repeat(64);
    developmentManifest = {
      schema: 'ultramodern-renderer-build',
      version: 1,
      profile: { renderer, compiler: { version: '2.0.0-rc.13' } },
      identities: Object.fromEntries(
        entryNames.map(entryName => [
          entryName,
          {
            renderer,
            appId: 'unit-authored-app',
            entryName,
            protocolVersion: 1,
            buildId: buildMarker,
          },
        ]),
      ),
      buildMarker,
      inputDigest: 'b'.repeat(64),
      profileDigest: 'c'.repeat(64),
      compilerDigest: 'd'.repeat(64),
      frameworkCohortDigest: 'e'.repeat(64),
      sourceRevision: 'unit-development-session',
      cacheAllowed: false,
      promotable: false,
      devCompilation: {
        compilationHashes: Object.fromEntries(
          environments.map(item => [item.name, item.compilationHash]),
        ),
        generation: 1,
        sourceInputDigest: 'f'.repeat(64),
      },
    };
    const source = JSON.stringify(developmentManifest);
    developmentMetadataFile = await addFile(
      'dist/.ultramodern-dev/renderer-build.json',
      source,
      ['development-manifest'],
    );
    development = {
      metadataFile: developmentMetadataFile,
      metadataSha256: sha256(source),
      devCompilation: structuredClone(developmentManifest.devCompilation),
    };
    for (const item of environments)
      item.nativeModuleManifests =
        renderer === 'solid' && item.name === 'client'
          ? entryNames.map(name => {
              const source = JSON.stringify({
                schemaVersion: 1,
                renderer,
                compilerVersion: developmentManifest.profile.compiler.version,
                rendererIdentity: developmentManifest.identities[name],
                modules: {
                  _base: '/assets/',
                  [`./native/${name}.tsx`]: { file: `${name}.js` },
                },
              });
              return {
                file: `solid-module-manifest.${name}.json`,
                sha256: sha256(source),
                size: Buffer.byteLength(source),
                source,
              };
            })
          : [];
  }
  const sourceInventory = [];
  for (const [relative, roles] of [...sourceRoles].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const bytes = await fs.readFile(path.join(applicationRoot, relative));
    sourceInventory.push({
      path: relative,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      roles,
    });
  }
  const observation = {
    schema: 'ultramodern-native-compiler-observation',
    version: 1,
    observer: {
      event:
        environment === 'development' ? 'onDevCompileDone' : 'onAfterBuild',
      order: 'post',
      rsbuildVersion: '2.2.9',
      sourceFile: path.join(applicationRoot, 'observe-native-compiler.ts'),
    },
    rootPath: applicationRoot,
    distPath: distDirectory,
    configFile: null,
    configFileDependencies: [path.join(applicationRoot, 'authored.config.ts')],
    configuredPlugins: plugins(renderer, 'api.getNormalizedConfig().plugins'),
    environments,
    sourceInventory,
    ...(development ? { development } : {}),
  };
  const persist = async () => {
    const bytes = `${JSON.stringify(observation, null, 2)}\n`;
    await fs.writeFile(receiptPath, bytes);
    await fs.writeFile(`${receiptPath}.sha256`, `${sha256(bytes)}\n`);
  };
  await persist();
  const parameters = {
    applicationRoot,
    distDirectory,
    renderer,
    expectedEntryNames: [...entryNames],
    ...(developmentManifest
      ? {
          environment,
          expectedDevelopmentManifest: structuredClone(developmentManifest),
        }
      : {}),
  };
  const read = () => readNativeCompilerObservation(parameters);
  const programs = {};
  for (const role of ['browser', 'server']) {
    const program = {
      compilerOptions: {
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        noCheck: false,
        types: role === 'browser' ? [] : ['node'],
      },
      files: [
        ...(role === 'server' ? ['modern.config.ts'] : []),
        ...nativeTypeEntries[role].map(file =>
          path.relative(applicationRoot, file),
        ),
      ],
      include: role === 'browser' ? ['src/**/*.tsx', 'src/**/*.tsrx'] : ['src'],
      exclude: [],
    };
    const programPath = path.join(applicationRoot, `tsconfig.${role}.json`);
    await fs.writeFile(programPath, JSON.stringify(program));
    programs[role] = { path: programPath, program };
  }
  return {
    applicationRoot,
    workspaceRoot,
    distDirectory,
    receiptPath,
    nativeTypeEntries,
    observation,
    parameters,
    read,
    persist,
    programs,
    developmentManifest,
    developmentMetadataFile,
    persistDevelopmentManifest: async () => {
      const bytes = JSON.stringify(developmentManifest);
      await fs.writeFile(developmentMetadataFile, bytes);
      observation.development.metadataSha256 = sha256(bytes);
      const source = observation.sourceInventory.find(
        item => item.path === 'dist/.ultramodern-dev/renderer-build.json',
      );
      source.sha256 = sha256(bytes);
      source.size = Buffer.byteLength(bytes);
    },
  };
}

async function rejectsReceipt(t, mutate) {
  const input = await fixture(t);
  await input.read();
  await mutate(input);
  await input.persist();
  await assert.rejects(input.read(), Error);
}

async function rejectsDevelopmentReceipt(t, mutate) {
  const input = await fixture(t, 'solid', 'development');
  await input.read();
  await mutate(input);
  await input.persist();
  await assert.rejects(input.read(), Error);
}

async function writeCompiledModule(input, relative, resourceSuffix = '') {
  const file = path.join(input.applicationRoot, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    `export const module = ${JSON.stringify(relative)};\n`,
  );
  return {
    identifier: `compiled|${file}${resourceSuffix}`,
    resource: `${file}${resourceSuffix}`,
    source: await compiledSource(file),
    modules: [],
  };
}

async function addStylesheet(input, file, bytes, startupEntries = []) {
  const client = input.observation.environments[0];
  const stylesheets = client.compiledStylesheets;
  const content = Buffer.from(bytes);
  const text = content.toString('utf8');
  const asset = {
    file,
    sha256: sha256(content),
    size: content.byteLength,
    source: Buffer.from(text).equals(content)
      ? { encoding: 'utf8', bytes: text }
      : { encoding: 'base64', bytes: content.toString('base64') },
  };
  stylesheets.assets.push(asset);
  for (const name of startupEntries) {
    client.compiledEntryFiles[name].push(file);
    stylesheets.startupFiles[name].push(file);
  }
  if (input.parameters.environment !== 'development') {
    const target = path.join(stylesheets.outputPath, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  sealStylesheets(stylesheets);
  return asset;
}

function rewriteMemoryManifest(record, mutate) {
  const manifest = JSON.parse(record.source);
  mutate(manifest);
  record.source = JSON.stringify(manifest);
  record.sha256 = sha256(record.source);
  record.size = Buffer.byteLength(record.source);
}

async function addSolidAuxiliary(input) {
  const client = input.observation.environments[0];
  const name = 'opaque-compiled-facade';
  const file = 'assets/opaque-native-module.js';
  client.compiledEntryNames.push(name);
  client.compiledEntryFiles[name] = ['assets/shared-runtime.js', file];
  client.compiledStylesheets.startupFiles[name] = [];
  sealStylesheets(client.compiledStylesheets);
  const identities = Object.fromEntries(
    entryNames.map(entryName => [
      entryName,
      {
        renderer: 'solid',
        appId: 'unit-authored-app',
        entryName,
        protocolVersion: 1,
        buildId: `unit-${entryName}-build`,
      },
    ]),
  );
  const metadata = {
    schema: 'ultramodern-renderer-build',
    version: 1,
    profile: { renderer: 'solid', compiler: { version: '2.0.0-rc.13' } },
    identities,
  };
  const metadataPath = path.join(input.distDirectory, 'renderer-build.json');
  await fs.writeFile(metadataPath, JSON.stringify(metadata));
  await fs.mkdir(path.join(input.distDirectory, 'assets'));
  const assetPath = path.join(input.distDirectory, file);
  await fs.writeFile(assetPath, 'export const nativeModule = true;\n');
  await fs.writeFile(
    path.join(input.distDirectory, 'assets/shared-runtime.js'),
    'export const runtime = true;\n',
  );
  const manifests = [];
  for (const entryName of entryNames) {
    const manifest = {
      schemaVersion: 1,
      renderer: 'solid',
      compilerVersion: '2.0.0-rc.13',
      rendererIdentity: identities[entryName],
      modules: { _base: '/assets/', './native/lazy.tsx': { file } },
    };
    const manifestPath = path.join(
      input.distDirectory,
      `solid-module-manifest.${entryName}.json`,
    );
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    manifests.push({ path: manifestPath, manifest });
  }
  await input.persist();
  return { name, file, assetPath, metadata, metadataPath, manifests };
}

for (const renderer of ['solid', 'octane']) {
  test(`${renderer} authenticates consumer files and keeps configured ownership observational`, async t => {
    const input = await fixture(t, renderer);
    const result = await input.read();
    assert.equal(result.receiptPath, input.receiptPath);
    assert.equal(
      result.receiptSha256,
      sha256(await fs.readFile(input.receiptPath)),
    );
    assert.deepEqual(result.observation, input.observation);
    assert.deepEqual(result.nativeTypeEntries, input.nativeTypeEntries);
    assert.deepEqual(
      result.sourceInventory,
      input.observation.sourceInventory.map(source => ({
        ...source,
        absolute: path.join(input.applicationRoot, source.path),
      })),
    );
    assert.equal(
      result.observation.configuredPlugins.appliedOwnership,
      'unavailable-public-api',
    );
    assert.deepEqual(
      result.observation.environments.map(
        environment => environment.configuredPlugins.plugins,
      ),
      [[], []],
    );
    await assertNativeCompilerObservationUnchanged(result);
    await assertNativeTypeProgramBindings(result, input.programs);
  });
}

test('keeps the stylesheet closure separate from entry startup CSS', async t => {
  const input = await fixture(t);
  const startup = await addStylesheet(
    input,
    'assets/startup.css',
    '.startup { color: green; }\n',
    ['csr'],
  );
  const lazy = await addStylesheet(
    input,
    'assets/lazy-route.css',
    '.lazy::before { content: "ř"; }\n',
  );
  const stylesheets = input.observation.environments[0].compiledStylesheets;
  stylesheets.publicPath = 'auto';
  sealStylesheets(stylesheets);
  await input.persist();
  const result = await input.read();
  assert.equal(result.clientStylesheets.publicPath, 'auto');
  assert.equal(result.clientStylesheets.outputPath, input.distDirectory);
  assert.deepEqual(result.clientStylesheets.assets, [startup, lazy]);
  assert.deepEqual(result.clientStylesheets.startupFiles, {
    csr: [startup.file],
    ssr: [],
  });
  assert.ok(
    !Object.values(input.observation.environments[0].compiledEntryFiles)
      .flat()
      .includes(lazy.file),
  );
  for (const asset of [startup, lazy])
    assert.ok(
      result.builtArtifacts.some(
        item =>
          item.absolute === path.join(input.distDirectory, asset.file) &&
          item.sha256 === asset.sha256 &&
          item.size === asset.size,
      ),
    );
  await assertNativeCompilerObservationUnchanged(result);
});

test('accepts a stylesheet closure with no startup CSS and preserves an empty public path', async t => {
  const input = await fixture(t);
  const lazy = await addStylesheet(
    input,
    'assets/only-lazy.css',
    '.lazy { display: grid; }\n',
  );
  await input.persist();
  const result = await input.read();
  assert.equal(result.clientStylesheets.publicPath, '');
  assert.deepEqual(result.clientStylesheets.assets, [lazy]);
  assert.deepEqual(result.clientStylesheets.startupFiles, { csr: [], ssr: [] });
});

test('requires the completed client stylesheet closure and exact startup membership', async t => {
  for (const mutate of [
    input => {
      delete input.observation.environments[0].compiledStylesheets;
    },
    input => {
      const server = input.observation.environments[1];
      server.compiledStylesheets = sealStylesheets({
        evidence: 'stats.compilation.getAssets',
        compilationHash: server.compilationHash,
        outputPath: server.distPath,
        publicPath: '/',
        assets: [],
        startupFiles: Object.fromEntries(
          server.compiledEntryNames.map(name => [name, []]),
        ),
      });
    },
    input => {
      input.observation.environments[0].compiledStylesheets.sha256 = '0'.repeat(
        64,
      );
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.evidence = 'configured-stylesheet-claims';
      sealStylesheets(stylesheets);
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.compilationHash = 'earlier-client-compilation';
      sealStylesheets(stylesheets);
    },
    async input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.outputPath = path.join(input.distDirectory, 'server');
      for (const asset of stylesheets.assets) {
        const target = path.join(stylesheets.outputPath, asset.file);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(
          target,
          Buffer.from(asset.source.bytes, asset.source.encoding),
        );
      }
      sealStylesheets(stylesheets);
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      delete stylesheets.startupFiles.ssr;
      sealStylesheets(stylesheets);
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.startupFiles.foreign = [];
      sealStylesheets(stylesheets);
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.startupFiles.csr.push(stylesheets.startupFiles.csr[0]);
      sealStylesheets(stylesheets);
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.startupFiles.csr = ['assets/lazy.css'];
      sealStylesheets(stylesheets);
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.startupFiles.csr = [];
      sealStylesheets(stylesheets);
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.assets = stylesheets.assets.filter(
        asset => asset.file !== 'assets/startup.css',
      );
      sealStylesheets(stylesheets);
    },
    input => {
      const stylesheets = input.observation.environments[0].compiledStylesheets;
      stylesheets.assets.push(structuredClone(stylesheets.assets[0]));
      sealStylesheets(stylesheets);
    },
  ]) {
    const input = await fixture(t);
    await addStylesheet(input, 'assets/startup.css', '.startup {}\n', ['csr']);
    await addStylesheet(input, 'assets/lazy.css', '.lazy {}\n');
    await input.persist();
    await input.read();
    await mutate(input);
    await input.persist();
    await assert.rejects(input.read(), Error);
  }
});

test('binds production stylesheet disk bytes and memory source hashes despite resealed receipts', async t => {
  for (const mutate of [
    async (input, asset) => {
      await fs.appendFile(
        path.join(input.distDirectory, asset.file),
        '/* stale production bytes */\n',
      );
    },
    (_input, asset) => {
      asset.sha256 = '0'.repeat(64);
    },
    (_input, asset) => {
      asset.size++;
    },
    (_input, asset) => {
      asset.source.bytes += '/* forged memory bytes */\n';
    },
    (_input, asset) => {
      asset.source = null;
    },
  ]) {
    const input = await fixture(t);
    const asset = await addStylesheet(input, 'assets/lazy.css', '.lazy {}\n');
    await input.persist();
    await input.read();
    await mutate(input, asset);
    sealStylesheets(input.observation.environments[0].compiledStylesheets);
    await input.persist();
    await assert.rejects(input.read(), Error);
  }
});

test('rechecks unloaded production CSS after accepting the compiler observation', async t => {
  const input = await fixture(t);
  const asset = await addStylesheet(input, 'assets/unloaded.css', '.lazy {}\n');
  await input.persist();
  const result = await input.read();
  await fs.appendFile(
    path.join(input.distDirectory, asset.file),
    '/* changed after acceptance */\n',
  );
  await assert.rejects(
    async () => assertNativeCompilerObservationUnchanged(result),
    Error,
  );
});

test('authenticates development memory CSS without trusting matching or forged disk files', async t => {
  const input = await fixture(t, 'solid', 'development');
  const startup = await addStylesheet(
    input,
    'assets/startup.css',
    '.startup { color: green; }\n',
    ['csr'],
  );
  const lazy = await addStylesheet(input, 'assets/lazy.css', '.lazy {}\n');
  await input.persist();
  const absentDisk = await input.read();
  assert.deepEqual(absentDisk.clientStylesheets.assets, [startup, lazy]);
  assert.deepEqual(absentDisk.builtArtifacts, []);
  for (const asset of [startup, lazy]) {
    const target = path.join(input.distDirectory, asset.file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '/* forged disk CSS */\n');
  }
  const forgedDisk = await input.read();
  assert.deepEqual(forgedDisk.clientStylesheets.assets, [startup, lazy]);
  await assertNativeCompilerObservationUnchanged(absentDisk);
  await assertNativeCompilerObservationUnchanged(forgedDisk);
  await fs.writeFile(
    path.join(input.distDirectory, lazy.file),
    lazy.source.bytes,
  );
  lazy.source.bytes += '/* forged callback source */\n';
  sealStylesheets(input.observation.environments[0].compiledStylesheets);
  await input.persist();
  await assert.rejects(input.read(), Error);
});

test('retains nested and child data modules and resource-less compiler modules', async t => {
  const input = await fixture(t);
  const graph = input.observation.environments[0].compiledModuleGraph;
  const nested = await writeCompiledModule(input, 'src/catalog.data.ts');
  const child = await writeCompiledModule(input, 'src/cart.data.ts');
  const runtime = {
    identifier: 'webpack/runtime/define property getters',
    resource: null,
    source: null,
    modules: [],
  };
  const external = {
    identifier: 'external "node:fs"',
    resource: null,
    source: null,
    modules: [],
  };
  graph.modules.push({
    identifier: 'concatenated catalog modules',
    resource: null,
    source: null,
    modules: [nested],
  });
  graph.modules.push(runtime, external);
  graph.children.push(
    sealModuleGraph({
      evidence: 'stats.compilation.modules',
      name: 'client-child',
      compilationHash: 'child-completed-hash',
      modules: [child],
      children: [],
    }),
  );
  sealModuleGraph(graph);
  await input.persist();
  const result = await input.read();
  for (const module of [nested, child, runtime, external]) {
    const actual = result.compiledModuleResources.browser.find(
      item => item.identifier === module.identifier,
    );
    assert.ok(actual);
    assert.equal(actual.resource, module.resource);
    assert.deepEqual(actual.source, module.source);
  }
  assert.ok(
    result.compiledModuleResources.browser.some(
      item => item.identifier === 'concatenated catalog modules',
    ),
  );
  assert.deepEqual(
    result.compiledModuleResources.server.map(item => item.resource),
    input.nativeTypeEntries.server,
  );
  for (const module of [nested, child])
    assert.ok(
      result.moduleSourceInventory.some(
        item =>
          item.absolute === module.source.path &&
          item.sha256 === module.source.sha256 &&
          item.size === module.source.size,
      ),
    );
  await assertNativeCompilerObservationUnchanged(result);
});

test('preserves query resources while binding their file portion to a canonical source', async t => {
  const input = await fixture(t);
  const graph = input.observation.environments[0].compiledModuleGraph;
  const module = await writeCompiledModule(
    input,
    'src/query.data.ts',
    '?compiler=browser#native',
  );
  graph.modules.push(module);
  sealModuleGraph(graph);
  await input.persist();
  const result = await input.read();
  const actual = result.compiledModuleResources.browser.find(
    item => item.identifier === module.identifier,
  );
  assert.equal(actual.resource, module.resource);
  assert.equal(
    actual.source.path,
    path.join(input.applicationRoot, 'src/query.data.ts'),
  );
  const repeated = {
    ...module,
    identifier: `${module.identifier}:second-query`,
    resource: `${module.source.path}#second-query`,
    source: { ...module.source },
  };
  graph.modules.push(repeated);
  sealModuleGraph(graph);
  await input.persist();
  const repeatedResult = await input.read();
  assert.equal(
    repeatedResult.moduleSourceInventory.filter(
      item => item.absolute === module.source.path,
    ).length,
    1,
  );
  const other = await writeCompiledModule(input, 'src/other.data.ts');
  module.resource = `${other.resource}?compiler=browser#native`;
  sealModuleGraph(graph);
  await input.persist();
  await assert.rejects(input.read(), Error);
});

test('binds escaped literal query characters and retains genuine data URI modules', async t => {
  const input = await fixture(t);
  const graph = input.observation.environments[0].compiledModuleGraph;
  const physical = await writeCompiledModule(input, 'src/literal?#.ts');
  const escapedPath = physical.source.path.replace(
    /[?#]/g,
    character => `\0${character}`,
  );
  physical.resource = `${escapedPath}?compiler=browser`;
  physical.identifier = `compiled|${physical.resource}`;
  const dataURI = {
    identifier: 'data:text/javascript,export%20default%20true;',
    resource: 'data:text/javascript,export%20default%20true;',
    source: null,
    modules: [],
  };
  graph.modules.push(physical, dataURI);
  sealModuleGraph(graph);
  await input.persist();
  const result = await input.read();
  for (const module of [physical, dataURI]) {
    const actual = result.compiledModuleResources.browser.find(
      item => item.identifier === module.identifier,
    );
    assert.ok(actual);
    assert.equal(actual.resource, module.resource);
    assert.deepEqual(actual.source, module.source);
  }
  assert.equal(
    physical.source.path,
    path.join(input.applicationRoot, 'src/literal?#.ts'),
  );
  const source = { ...physical.source };
  for (const selected of ['physical-source-null', 'data-source-claim']) {
    physical.source = { ...source };
    dataURI.source = null;
    if (selected === 'physical-source-null') physical.source = null;
    else dataURI.source = { ...source };
    sealModuleGraph(graph);
    await input.persist();
    await assert.rejects(input.read(), Error);
  }
});

test('requires authenticated graph evidence for each completed compiler environment', async t => {
  for (const mutate of [
    input => {
      delete input.observation.environments[0].compiledModuleGraph;
    },
    input => {
      delete input.observation.environments[1].compiledModuleGraph;
    },
    input => {
      input.observation.environments[0].compiledModuleGraph.sha256 = '0'.repeat(
        64,
      );
    },
    input => {
      const graph = input.observation.environments[0].compiledModuleGraph;
      graph.evidence = 'configured-entry-claims';
      sealModuleGraph(graph);
    },
    input => {
      const graph = input.observation.environments[0].compiledModuleGraph;
      graph.name = 'foreign-client';
      sealModuleGraph(graph);
    },
    input => {
      const graph = input.observation.environments[0].compiledModuleGraph;
      graph.compilationHash = 'earlier-build';
      sealModuleGraph(graph);
    },
    input => {
      const graph = input.observation.environments[0].compiledModuleGraph;
      graph.children.push({
        evidence: 'stats.compilation.modules',
        name: null,
        compilationHash: null,
        modules: [],
        children: [],
        sha256: '0'.repeat(64),
      });
      sealModuleGraph(graph);
    },
    input => {
      const graph = input.observation.environments[0].compiledModuleGraph;
      const child = sealModuleGraph({
        evidence: 'stats.compilation.modules',
        name: null,
        compilationHash: null,
        modules: [],
        children: [],
      });
      graph.children.push(child);
      child.modules.push({
        identifier: 'later runtime module',
        resource: null,
        source: null,
        modules: [],
      });
      sealModuleGraph(graph);
    },
  ])
    await rejectsReceipt(t, mutate);
});

test('checks physical module source pins after graph and receipt digests are recomputed', async t => {
  for (const mutate of [
    module => {
      module.source.sha256 = '0'.repeat(64);
    },
    module => {
      module.source.size++;
    },
    async module => {
      await fs.appendFile(module.source.path, '// source drift\n');
    },
    module => {
      module.source.path = path.relative(
        path.dirname(module.source.path),
        module.source.path,
      );
    },
    module => {
      module.source = null;
    },
    module => {
      module.resource = null;
    },
  ]) {
    const input = await fixture(t);
    const graph = input.observation.environments[0].compiledModuleGraph;
    const module = await writeCompiledModule(input, 'src/transitive.data.ts');
    graph.modules.push(module);
    sealModuleGraph(graph);
    await input.persist();
    await input.read();
    await mutate(module);
    sealModuleGraph(graph);
    await input.persist();
    await assert.rejects(input.read(), Error);
  }
});

test('admits workspace module sources only under the explicitly pinned consumer root', async t => {
  const input = await fixture(t, 'solid', 'production', {
    nestedApplication: true,
  });
  const file = path.join(
    input.workspaceRoot,
    'node_modules/workspace-library/index.js',
  );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'export const workspaceLibrary = true;\n');
  const graph = input.observation.environments[0].compiledModuleGraph;
  const module = {
    identifier: file,
    resource: `${file}?browser`,
    source: await compiledSource(file),
    modules: [],
  };
  graph.modules.push(module);
  sealModuleGraph(graph);
  await input.persist();
  await assert.rejects(input.read(), Error);
  input.parameters.consumerRoot = input.workspaceRoot;
  const result = await input.read();
  assert.ok(
    result.compiledModuleResources.browser.some(
      item => item.source?.path === file,
    ),
  );
  await assertNativeCompilerObservationUnchanged(result);
  const foreign = await fs.mkdtemp(
    path.join(
      process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
      'compiler-reader-outside-workspace-',
    ),
  );
  t.after(() => fs.rm(foreign, { recursive: true, force: true }));
  const foreignFile = path.join(await fs.realpath(foreign), 'foreign.js');
  await fs.writeFile(foreignFile, 'export const outsideWorkspace = true;\n');
  module.resource = foreignFile;
  module.source = await compiledSource(foreignFile);
  sealModuleGraph(graph);
  await input.persist();
  await assert.rejects(input.read(), Error);
});

test('rejects escaped module resources and symlink source pins after digest recomputation', async t => {
  for (const selected of [
    'outside-root',
    'source-symlink',
    'escaping-resource-symlink',
  ]) {
    const input = await fixture(t);
    const foreign = await fs.mkdtemp(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'compiler-reader-foreign-',
      ),
    );
    t.after(() => fs.rm(foreign, { recursive: true, force: true }));
    const foreignRoot = await fs.realpath(foreign);
    const foreignFile = path.join(foreignRoot, 'foreign.js');
    await fs.writeFile(foreignFile, 'export const foreign = true;\n');
    const graph = input.observation.environments[0].compiledModuleGraph;
    const module = await writeCompiledModule(input, 'src/owned-module.ts');
    if (selected === 'outside-root') {
      module.resource = foreignFile;
      module.source = await compiledSource(foreignFile);
    } else if (selected === 'source-symlink') {
      const alias = path.join(input.applicationRoot, 'src/source-alias.ts');
      await fs.symlink(module.source.path, alias);
      module.source.path = alias;
    } else {
      const alias = path.join(input.applicationRoot, 'src/foreign-package');
      await fs.symlink(foreignRoot, alias);
      module.resource = path.join(alias, 'foreign.js');
      module.source = await compiledSource(foreignFile);
    }
    graph.modules.push(module);
    sealModuleGraph(graph);
    await input.persist();
    await assert.rejects(input.read(), Error);
  }
});

test('rechecks transitive graph source files and graph receipt changes after acceptance', async t => {
  for (const selected of ['nested-source', 'child-source', 'graph-receipt']) {
    const input = await fixture(t);
    const graph = input.observation.environments[0].compiledModuleGraph;
    const module = await writeCompiledModule(input, 'src/rechecked.data.ts');
    if (selected === 'child-source')
      graph.children.push(
        sealModuleGraph({
          evidence: 'stats.compilation.modules',
          name: 'client-child',
          compilationHash: 'child-completed-hash',
          modules: [module],
          children: [],
        }),
      );
    else
      graph.modules.push({
        identifier: 'concatenated rechecked module',
        resource: null,
        source: null,
        modules: [module],
      });
    sealModuleGraph(graph);
    await input.persist();
    const result = await input.read();
    if (selected === 'graph-receipt') {
      module.identifier = 'later compilation module';
      sealModuleGraph(graph);
      await input.persist();
    } else
      await fs.appendFile(module.source.path, '// later transitive change\n');
    await assert.rejects(
      async () => assertNativeCompilerObservationUnchanged(result),
      Error,
    );
  }
});

test('rejects a client module changed while a later server graph source is read', async t => {
  const input = await fixture(t);
  const clientModule = await writeCompiledModule(
    input,
    'src/client-race.data.ts',
  );
  const serverModule = await writeCompiledModule(
    input,
    'src/server-race.data.ts',
  );
  for (const [index, module] of [clientModule, serverModule].entries()) {
    const graph = input.observation.environments[index].compiledModuleGraph;
    graph.modules.push(module);
    sealModuleGraph(graph);
  }
  await input.persist();
  const readFile = fs.readFile;
  let changed = false;
  const mockedReadFile = t.mock.method(
    fs,
    'readFile',
    async (file, ...options) => {
      const bytes = await readFile(file, ...options);
      if (file === serverModule.source.path && !changed) {
        changed = true;
        await fs.appendFile(
          clientModule.source.path,
          '// changed during reader\n',
        );
      }
      return bytes;
    },
  );
  t.after(() => mockedReadFile.mock.restore());
  await assert.rejects(input.read(), Error);
  assert.equal(changed, true);
});

test('reads a React client module graph without native generated roots or compiler ownership claims', async t => {
  const input = await fixture(t, 'react');
  input.observation.configuredPlugins = plugins(
    'react',
    'api.getNormalizedConfig().plugins',
    false,
  );
  const module = await writeCompiledModule(input, 'src/react-client.data.ts');
  const graph = input.observation.environments[0].compiledModuleGraph;
  graph.modules.push(module);
  sealModuleGraph(graph);
  await input.persist();
  const result = await readCompiledClientModuleGraph(input.parameters);
  assert.ok(
    result.compiledModuleResources.browser.some(
      item => item.source?.path === module.source.path,
    ),
  );
  assert.equal(result.observation.configuredPlugins.plugins.length, 0);
  await assertNativeCompilerObservationUnchanged(result);
  graph.sha256 = '0'.repeat(64);
  await input.persist();
  await assert.rejects(readCompiledClientModuleGraph(input.parameters), Error);
});

test('rejects unauthenticated receipt bytes and stale copied observer code', async t => {
  const input = await fixture(t);
  await input.read();
  await fs.appendFile(input.receiptPath, ' ');
  await assert.rejects(input.read(), Error);
  await input.persist();
  await fs.writeFile(`${input.receiptPath}.sha256`, `${'0'.repeat(64)}\n`);
  await assert.rejects(input.read(), Error);
  await rejectsReceipt(t, async stale => {
    const source = stale.observation.sourceInventory.find(
      file => file.path === 'observe-native-compiler.ts',
    );
    const old = Buffer.from(
      'export function observeNativeCompiler() { return {}; }\n',
    );
    await fs.writeFile(path.join(stale.applicationRoot, source.path), old);
    source.sha256 = sha256(old);
    source.size = old.byteLength;
  });
});

test('records a distinct executing file as source evidence without claiming trusted source equivalence', async t => {
  const input = await fixture(t);
  const bytes = Buffer.from('export const observedExecutingFile = true;\n');
  const file = path.join(input.applicationRoot, 'executing-observer.js');
  await fs.writeFile(file, bytes);
  input.observation.sourceInventory.push({
    path: 'executing-observer.js',
    sha256: sha256(bytes),
    size: bytes.byteLength,
    roles: ['executing-observer'],
  });
  input.observation.observer.sourceFile = file;
  await input.persist();
  const result = await input.read();
  assert.equal(result.observation.observer.sourceFile, file);
  assert.equal(
    result.sourceInventory.find(source => source.absolute === file).sha256,
    sha256(bytes),
  );
  await fs.appendFile(file, '// drift\n');
  await assert.rejects(
    async () => assertNativeCompilerObservationUnchanged(result),
    Error,
  );
});

test('binds root, dist and completed post-build SDK observations to this consumer', async t => {
  for (const mutate of [
    input => {
      input.observation.rootPath = path.dirname(input.applicationRoot);
    },
    input => {
      input.observation.distPath = input.applicationRoot;
    },
    input => {
      input.observation.observer.event = 'onBeforeBuild';
    },
    input => {
      input.observation.observer.order = 'pre';
    },
    input => {
      input.observation.observer.rsbuildVersion = '1.0.0';
    },
    input => {
      input.observation.environments[0].target = 'node';
    },
    input => {
      input.observation.environments[1].target = 'web';
    },
    input => {
      input.observation.environments[0].mode = 'development';
    },
    input => {
      input.observation.environments[1].distPath = input.applicationRoot;
    },
    input => {
      input.observation.environments[0].hasErrors = true;
    },
    input => {
      input.observation.environments[1].errorCount = 1;
    },
    input => {
      input.observation.environments[0].compilationHash = '';
    },
    input => {
      input.observation.environments.pop();
    },
  ])
    await rejectsReceipt(t, mutate);
});

test('requires exact entry names and matching observed root maps', async t => {
  for (const mutate of [
    input => {
      input.observation.environments[0].compiledEntryNames.pop();
    },
    input => {
      input.observation.environments[0].compiledEntryNames.push('foreign');
    },
    input => {
      input.observation.environments[0].compiledEntryNames.push('csr');
    },
    input => {
      input.observation.environments[0].compiledEntryFiles.csr = [];
    },
    input => {
      delete input.observation.environments[0].compiledEntryFiles.csr;
    },
    input => {
      delete input.observation.environments[0].entry.csr;
    },
    input => {
      input.observation.environments[0].entry.foreign =
        input.observation.environments[0].entry.csr;
    },
    input => {
      input.observation.environments[0].configSourceEntry.csr = [
        input.nativeTypeEntries.browser[1],
      ];
    },
    input => {
      input.observation.environments[0].entry.csr =
        input.observation.environments[0].entry.csr[0];
    },
  ])
    await rejectsReceipt(t, mutate);
});

test('requires one actual generated root for each compiler role and rejects aliases or external roots', async t => {
  for (const mutate of [
    input => {
      input.observation.environments[0].entry.csr[0] =
        input.nativeTypeEntries.server[0];
      input.observation.environments[0].configSourceEntry.csr[0] =
        input.nativeTypeEntries.server[0];
    },
    input => {
      input.observation.environments[0].entry.csr = [
        path.join(input.applicationRoot, 'src/startup.ts'),
      ];
      input.observation.environments[0].configSourceEntry.csr = [
        ...input.observation.environments[0].entry.csr,
      ];
    },
    input => {
      input.observation.environments[0].entry.csr.push(
        input.nativeTypeEntries.browser[1],
      );
      input.observation.environments[0].configSourceEntry.csr.push(
        input.nativeTypeEntries.browser[1],
      );
    },
    input => {
      input.observation.environments[0].entry.csr.push('../foreign.ts');
      input.observation.environments[0].configSourceEntry.csr.push(
        '../foreign.ts',
      );
    },
    async input => {
      const generated = input.nativeTypeEntries.browser[0];
      await fs.rm(generated);
      await fs.symlink(observerSource, generated);
    },
  ])
    await rejectsReceipt(t, mutate);
});

test('requires unique inventoried relative files with exact bytes, sizes and all owning roles', async t => {
  for (const mutate of [
    input => {
      input.observation.sourceInventory.push(
        structuredClone(input.observation.sourceInventory[0]),
      );
    },
    input => {
      input.observation.sourceInventory[0].path = '../foreign.config.ts';
    },
    input => {
      input.observation.sourceInventory[0].sha256 = '0'.repeat(64);
    },
    input => {
      input.observation.sourceInventory[0].size++;
    },
    input => {
      input.observation.sourceInventory =
        input.observation.sourceInventory.filter(
          file => file.path !== 'src/startup.ts',
        );
    },
    input => {
      input.observation.sourceInventory.find(
        file => file.path === 'modern.config.ts',
      ).roles = [];
    },
    input => {
      input.observation.sourceInventory.find(
        file => file.path === 'observe-native-compiler.ts',
      ).roles = ['fixture-observer'];
    },
    input => {
      input.observation.sourceInventory.find(file =>
        file.path.endsWith('csr/index.ts'),
      ).roles = [
        'environment:server:entry',
        'environment:server:config-source-entry',
      ];
    },
    async input => {
      await fs.appendFile(
        path.join(input.applicationRoot, 'authored.config.ts'),
        '// changed source\n',
      );
    },
    input => {
      input.observation.configFile = path.join(
        input.applicationRoot,
        'modern.config.ts',
      );
    },
  ])
    await rejectsReceipt(t, mutate);
});

test('rejects malformed configured facts and conflicting renderer claims without certifying apply ownership', async t => {
  for (const mutate of [
    input => {
      input.observation.configuredPlugins.names = ['different'];
    },
    input => {
      input.observation.configuredPlugins.appliedOwnership = 'applied';
    },
    input => {
      input.observation.configuredPlugins.plugins[0].configuredClaim.renderer =
        'octane';
    },
    input => {
      input.observation.configuredPlugins.plugins[0].configuredClaim.transform =
        'react';
    },
    input => {
      const extra = structuredClone(
        input.observation.configuredPlugins.plugins[0],
      );
      extra.name = 'extra-native-compiler';
      input.observation.configuredPlugins.plugins.push(extra);
      input.observation.configuredPlugins.names.push(extra.name);
    },
    input => {
      input.observation.configuredPlugins.plugins.push({
        name: 'rsbuild:react',
        configuredClaim: null,
      });
      input.observation.configuredPlugins.names.push('rsbuild:react');
    },
    input => {
      input.observation.environments[0].configuredPlugins = plugins(
        'solid',
        'environment.config.plugins',
      );
      const configured = input.observation.environments[0].configuredPlugins;
      configured.plugins.push(structuredClone(configured.plugins[0]));
      configured.names.push(configured.names[0]);
    },
  ])
    await rejectsReceipt(t, mutate);
});

test('detects receipt and source changes after accepting an observation', async t => {
  for (const mutate of [
    async input => {
      input.observation.environments[0].compilationHash = 'later-build';
      await input.persist();
    },
    async input => {
      await fs.appendFile(
        path.join(input.applicationRoot, 'src/startup.ts'),
        '// late drift\n',
      );
    },
    async input => {
      await fs.writeFile(`${input.receiptPath}.sha256`, `${'0'.repeat(64)}\n`);
    },
  ]) {
    const input = await fixture(t);
    const result = await input.read();
    await mutate(input);
    await assert.rejects(
      async () => assertNativeCompilerObservationUnchanged(result),
      Error,
    );
  }
});

test('accepts a genuine SDK config source and an absent SDK dependency list', async t => {
  const input = await fixture(t);
  input.observation.configFile = path.join(
    input.applicationRoot,
    'modern.config.ts',
  );
  input.observation.sourceInventory
    .find(source => source.path === 'modern.config.ts')
    .roles.push('sdk-config');
  input.observation.configFileDependencies = [];
  await input.persist();
  const result = await input.read();
  assert.equal(result.observation.configFile, input.observation.configFile);
  assert.deepEqual(result.observation.configFileDependencies, []);
});

test('admits a Solid auxiliary only through exact actual hydration asset membership', async t => {
  const input = await fixture(t);
  const auxiliary = await addSolidAuxiliary(input);
  const result = await input.read();
  assert.deepEqual(result.auxiliaryCompiledEntries, [
    {
      environment: 'client',
      name: auxiliary.name,
      files: ['assets/shared-runtime.js', auxiliary.file],
      nativeModuleFile: auxiliary.file,
    },
  ]);
  assert.deepEqual(result.nativeTypeEntries, input.nativeTypeEntries);
  assert.ok(
    result.builtArtifacts.some(
      artifact => artifact.absolute === auxiliary.assetPath,
    ),
  );
  for (const artifact of result.builtArtifacts) {
    const bytes = await fs.readFile(artifact.absolute);
    assert.equal(artifact.sha256, sha256(bytes));
    assert.equal(artifact.size, bytes.byteLength);
  }
  await assertNativeCompilerObservationUnchanged(result);
});

test('rejects unowned auxiliaries, mismatched hydration identity and missing actual assets', async t => {
  for (const mutate of [
    (input, auxiliary) => {
      input.observation.environments[0].compiledEntryFiles[auxiliary.name] = [
        'assets/shared-runtime.js',
      ];
    },
    (input, auxiliary) => {
      input.observation.environments[1].compiledEntryNames.push(auxiliary.name);
      input.observation.environments[1].compiledEntryFiles[auxiliary.name] = [
        auxiliary.file,
      ];
    },
    async (_input, auxiliary) => {
      auxiliary.manifests[0].manifest.rendererIdentity = {
        ...auxiliary.manifests[0].manifest.rendererIdentity,
        buildId: 'foreign-build',
      };
      await fs.writeFile(
        auxiliary.manifests[0].path,
        JSON.stringify(auxiliary.manifests[0].manifest),
      );
    },
    async (_input, auxiliary) => {
      auxiliary.metadata.profile.compiler.version = '1.0.0';
      await fs.writeFile(
        auxiliary.metadataPath,
        JSON.stringify(auxiliary.metadata),
      );
    },
    async (_input, auxiliary) => {
      await fs.rm(auxiliary.assetPath);
    },
    async (_input, auxiliary) => {
      await fs.rm(auxiliary.assetPath);
      await fs.symlink(observerSource, auxiliary.assetPath);
    },
  ]) {
    const input = await fixture(t);
    const auxiliary = await addSolidAuxiliary(input);
    await input.read();
    await mutate(input, auxiliary);
    await input.persist();
    await assert.rejects(input.read(), Error);
  }
});

test('keeps auxiliary admission disabled for Octane even with matching facade filenames', async t => {
  const input = await fixture(t, 'octane');
  await input.read();
  input.observation.environments[0].compiledEntryNames.push('opaque-facade');
  input.observation.environments[0].compiledEntryFiles['opaque-facade'] = [
    'opaque.js',
  ];
  input.observation.environments[0].compiledStylesheets.startupFiles[
    'opaque-facade'
  ] = [];
  sealStylesheets(input.observation.environments[0].compiledStylesheets);
  await input.persist();
  await assert.rejects(
    input.read(),
    /unadmitted auxiliary compiled entrypoints/u,
  );
});

test('rechecks native module assets and owning manifests after accepting an auxiliary', async t => {
  for (const selected of ['asset', 'manifest', 'metadata']) {
    const input = await fixture(t);
    const auxiliary = await addSolidAuxiliary(input);
    const result = await input.read();
    const file =
      selected === 'asset'
        ? auxiliary.assetPath
        : selected === 'manifest'
          ? auxiliary.manifests[0].path
          : auxiliary.metadataPath;
    await fs.appendFile(file, ' ');
    await assert.rejects(
      async () => assertNativeCompilerObservationUnchanged(result),
      Error,
    );
  }
});

test('binds split type programs to exact generated roots and rejects ambient or scope expansion', async t => {
  for (const mutate of [
    input => {
      input.programs.browser.program.files =
        input.programs.server.program.files;
    },
    input => {
      input.programs.server.program.files =
        input.programs.server.program.files.filter(
          file => file !== 'modern.config.ts',
        );
    },
    input => {
      input.programs.browser.program.files.push('src/startup.ts');
    },
    input => {
      input.programs.browser.program.compilerOptions.types = ['react'];
    },
    input => {
      input.programs.server.program.compilerOptions.types = ['node', 'react'];
    },
    input => {
      input.programs.browser.program.compilerOptions.strict = false;
    },
    input => {
      input.programs.server.program.compilerOptions.skipLibCheck = true;
    },
    input => {
      input.programs.browser.program.compilerOptions.noEmit = false;
    },
    input => {
      input.programs.browser.program.compilerOptions.noCheck = true;
    },
    async input => {
      delete input.programs.server.program.compilerOptions.noCheck;
      input.programs.server.program.extends = './unchecked-base.json';
      await fs.writeFile(
        path.join(input.applicationRoot, 'unchecked-base.json'),
        JSON.stringify({ compilerOptions: { noCheck: true } }),
      );
    },
    input => {
      input.programs.browser.program.include = [
        'src',
        'node_modules/.modern-js',
      ];
    },
    input => {
      input.programs.server.program.exclude = ['src/server'];
    },
    input => {
      input.programs.server.path = input.programs.browser.path;
    },
    input => {
      input.programs.browser.path = path.join(
        path.dirname(input.applicationRoot),
        'foreign.json',
      );
    },
  ]) {
    const input = await fixture(t);
    const result = await input.read();
    await assertNativeTypeProgramBindings(result, input.programs);
    await mutate(input);
    for (const role of ['browser', 'server']) {
      if (
        input.programs[role].path.startsWith(
          `${input.applicationRoot}${path.sep}`,
        )
      )
        await fs.writeFile(
          input.programs[role].path,
          JSON.stringify(input.programs[role].program),
        );
    }
    await assert.rejects(
      async () => assertNativeTypeProgramBindings(result, input.programs),
      Error,
    );
  }
});

for (const renderer of ['solid', 'octane']) {
  test(`${renderer} authenticates the current dev wave without reading production output or memory assets from disk`, async t => {
    const input = await fixture(t, renderer, 'development');
    await fs.writeFile(
      path.join(input.distDirectory, 'renderer-build.json'),
      'untouched production metadata',
    );
    await fs.writeFile(
      path.join(input.distDirectory, 'native-compiler-observation.json'),
      'untouched production receipt',
    );
    for (const environment of input.observation.environments)
      for (const files of Object.values(environment.compiledEntryFiles))
        for (const file of files)
          await fs.rm(path.join(environment.distPath, file));
    const result = await input.read();
    assert.equal(result.environment, 'development');
    assert.equal(result.receiptPath, input.receiptPath);
    assert.equal(result.observation.observer.event, 'onDevCompileDone');
    assert.equal(
      result.observation.development.metadataFile,
      input.developmentMetadataFile,
    );
    assert.deepEqual(result.nativeTypeEntries, input.nativeTypeEntries);
    assert.deepEqual(result.builtArtifacts, []);
    assert.equal(
      result.sourceInventory.filter(source =>
        source.roles.includes('environment:server:route-ir'),
      ).length,
      entryNames.length,
    );
    assert.notEqual(
      input.developmentManifest.devCompilation.sourceInputDigest,
      input.developmentManifest.inputDigest,
    );
    await assertNativeCompilerObservationUnchanged(result);
    await assertNativeTypeProgramBindings(result, input.programs);
    assert.equal(
      await fs.readFile(
        path.join(input.distDirectory, 'renderer-build.json'),
        'utf8',
      ),
      'untouched production metadata',
    );
  });
}

test('requires the private development receipt and never falls back to a production receipt', async t => {
  const input = await fixture(t, 'solid', 'development');
  await fs.copyFile(
    input.receiptPath,
    path.join(input.distDirectory, 'native-compiler-observation.json'),
  );
  await fs.copyFile(
    `${input.receiptPath}.sha256`,
    path.join(input.distDirectory, 'native-compiler-observation.json.sha256'),
  );
  await fs.rm(input.receiptPath);
  await assert.rejects(input.read(), Error);
});

test('binds development to supported post-completion evidence and the exact canonical manifest bytes', async t => {
  for (const mutate of [
    input => {
      input.observation.observer.event = 'onAfterBuild';
    },
    input => {
      input.observation.observer.order = 'pre';
    },
    input => {
      input.observation.environments[0].mode = 'production';
    },
    input => {
      input.observation.development.metadataFile = path.join(
        input.distDirectory,
        'renderer-build.json',
      );
    },
    input => {
      input.observation.development.metadataSha256 = '0'.repeat(64);
    },
    input => {
      delete input.observation.development;
    },
    input => {
      input.observation.development.checkpointRoot = input.distDirectory;
    },
    input => {
      delete input.parameters.expectedDevelopmentManifest;
    },
    input => {
      input.parameters.expectedDevelopmentManifest.frameworkCohortDigest =
        '0'.repeat(64);
    },
    async input => {
      await fs.appendFile(input.developmentMetadataFile, ' ');
    },
  ])
    await rejectsDevelopmentReceipt(t, mutate);
});

test('requires exact current generation, source digest and every observed client/server compiler hash', async t => {
  for (const mutate of [
    input => {
      input.observation.development.devCompilation.generation++;
    },
    input => {
      input.observation.development.devCompilation.sourceInputDigest =
        '0'.repeat(64);
    },
    input => {
      input.observation.development.devCompilation.compilationHashes.client =
        'abcdef';
    },
    input => {
      input.observation.environments[1].compilationHash = 'abcdef';
    },
    async input => {
      input.developmentManifest.devCompilation.compilationHashes.foreign =
        'abcdef';
      input.parameters.expectedDevelopmentManifest = structuredClone(
        input.developmentManifest,
      );
      input.observation.development.devCompilation = structuredClone(
        input.developmentManifest.devCompilation,
      );
      await input.persistDevelopmentManifest();
    },
    async input => {
      input.developmentManifest.devCompilation.generation = 0;
      input.parameters.expectedDevelopmentManifest = structuredClone(
        input.developmentManifest,
      );
      input.observation.development.devCompilation = structuredClone(
        input.developmentManifest.devCompilation,
      );
      await input.persistDevelopmentManifest();
    },
    async input => {
      input.developmentManifest.devCompilation.compilationHashes.client =
        'ABCD';
      input.observation.environments[0].compilationHash = 'ABCD';
      input.parameters.expectedDevelopmentManifest = structuredClone(
        input.developmentManifest,
      );
      input.observation.development.devCompilation = structuredClone(
        input.developmentManifest.devCompilation,
      );
      await input.persistDevelopmentManifest();
    },
    input => {
      input.observation.development.devCompilation.foreign = 'unsupported';
    },
  ])
    await rejectsDevelopmentReceipt(t, mutate);
});

test('pins dev metadata and actual generated route IR alongside compiler source roots', async t => {
  for (const mutate of [
    input => {
      input.observation.sourceInventory.find(
        source => source.path === 'dist/.ultramodern-dev/renderer-build.json',
      ).roles = ['fixture-config'];
    },
    input => {
      input.observation.sourceInventory.find(source =>
        source.path.endsWith('csr/routes.server.ts'),
      ).roles = ['environment:server:entry'];
    },
    async input => {
      await fs.appendFile(
        path.join(
          path.dirname(input.nativeTypeEntries.server[0]),
          'routes.server.ts',
        ),
        '// later route generation\n',
      );
    },
    async input => {
      await fs.rm(input.developmentMetadataFile);
      await fs.symlink(observerSource, input.developmentMetadataFile);
    },
  ])
    await rejectsDevelopmentReceipt(t, mutate);
  for (const selected of ['metadata', 'route-ir']) {
    const input = await fixture(t, 'solid', 'development');
    const result = await input.read();
    const file =
      selected === 'metadata'
        ? input.developmentMetadataFile
        : path.join(
            path.dirname(input.nativeTypeEntries.server[0]),
            'routes.server.ts',
          );
    await fs.appendFile(file, ' ');
    await assert.rejects(
      async () => assertNativeCompilerObservationUnchanged(result),
      Error,
    );
  }
});

test('accepts a new dev generation only with a new receipt matching its manifest and current stats', async t => {
  const input = await fixture(t, 'solid', 'development');
  const first = await input.read();
  input.developmentManifest.devCompilation.generation++;
  input.developmentManifest.devCompilation.sourceInputDigest = '0'.repeat(64);
  input.developmentManifest.devCompilation.compilationHashes.client = '5678';
  input.observation.environments[0].compilationHash = '5678';
  input.observation.environments[0].compiledModuleGraph.compilationHash =
    '5678';
  sealModuleGraph(input.observation.environments[0].compiledModuleGraph);
  input.observation.environments[0].compiledStylesheets.compilationHash =
    '5678';
  sealStylesheets(input.observation.environments[0].compiledStylesheets);
  input.observation.development.devCompilation = structuredClone(
    input.developmentManifest.devCompilation,
  );
  input.parameters.expectedDevelopmentManifest = structuredClone(
    input.developmentManifest,
  );
  await input.persistDevelopmentManifest();
  await input.persist();
  await assert.rejects(
    async () => assertNativeCompilerObservationUnchanged(first),
    Error,
  );
  const second = await input.read();
  assert.equal(second.observation.development.devCompilation.generation, 2);
  await assertNativeCompilerObservationUnchanged(second);
});

test('admits dev Solid auxiliary files only through exact observed memory hydration manifest membership', async t => {
  const input = await fixture(t, 'solid', 'development');
  const client = input.observation.environments[0];
  const name = 'opaque-dev-facade';
  const file = 'assets/opaque-native-module.js';
  client.compiledEntryNames.push(name);
  client.compiledEntryFiles[name] = ['assets/shared-runtime.js', file];
  client.compiledStylesheets.startupFiles[name] = [];
  sealStylesheets(client.compiledStylesheets);
  for (const record of client.nativeModuleManifests)
    rewriteMemoryManifest(record, manifest => {
      manifest.modules['./native/lazy.tsx'] = { file };
    });
  await input.persist();
  const result = await input.read();
  assert.deepEqual(result.auxiliaryCompiledEntries, [
    {
      environment: 'client',
      name,
      files: ['assets/shared-runtime.js', file],
      nativeModuleFile: file,
    },
  ]);
  assert.deepEqual(result.builtArtifacts, []);
  await assert.rejects(fs.stat(path.join(input.distDirectory, file)), {
    code: 'ENOENT',
  });
  client.compiledEntryFiles[name] = ['assets/shared-runtime.js'];
  await input.persist();
  await assert.rejects(input.read(), Error);
});

test('rejects malformed or conflicting dev memory manifest evidence', async t => {
  for (const mutate of [
    input => {
      input.observation.environments[0].nativeModuleManifests.pop();
    },
    input => {
      const records = input.observation.environments[0].nativeModuleManifests;
      records.push(structuredClone(records[0]));
    },
    input => {
      input.observation.environments[0].nativeModuleManifests[0].sha256 =
        '0'.repeat(64);
    },
    input => {
      input.observation.environments[0].nativeModuleManifests[0].size++;
    },
    input => {
      input.observation.environments[0].nativeModuleManifests[0].source += ' ';
    },
    input => {
      rewriteMemoryManifest(
        input.observation.environments[0].nativeModuleManifests[0],
        manifest => {
          manifest.rendererIdentity.buildId = 'foreign';
        },
      );
    },
    input => {
      rewriteMemoryManifest(
        input.observation.environments[0].nativeModuleManifests[0],
        manifest => {
          manifest.compilerVersion = 'foreign';
        },
      );
    },
    input => {
      rewriteMemoryManifest(
        input.observation.environments[0].nativeModuleManifests[0],
        manifest => {
          manifest.modules['./native/foreign.tsx'] = { file: '../foreign.js' };
        },
      );
    },
    input => {
      input.observation.environments[1].nativeModuleManifests = [
        input.observation.environments[0].nativeModuleManifests[0],
      ];
    },
  ])
    await rejectsDevelopmentReceipt(t, mutate);
});

test('preserves compiler-owner guards and auxiliary role boundaries in development', async t => {
  for (const renderer of ['solid', 'octane']) {
    const input = await fixture(t, renderer, 'development');
    await input.read();
    input.observation.environments[1].compiledEntryNames.push('foreign');
    input.observation.environments[1].compiledEntryFiles.foreign = [
      'foreign.js',
    ];
    await input.persist();
    await assert.rejects(input.read(), Error);
  }
  await rejectsDevelopmentReceipt(t, input => {
    input.observation.configuredPlugins = plugins(
      'solid',
      'api.getNormalizedConfig().plugins',
      false,
    );
  });
  await rejectsDevelopmentReceipt(t, input => {
    const facts = input.observation.environments[0].configuredPlugins;
    facts.plugins.push({ name: 'rsbuild:svgr', configuredClaim: null });
    facts.names.push('rsbuild:svgr');
  });
  const octane = await fixture(t, 'octane', 'development');
  octane.observation.environments[0].compiledEntryNames.push('foreign');
  octane.observation.environments[0].compiledEntryFiles.foreign = [
    'foreign.js',
  ];
  octane.observation.environments[0].compiledStylesheets.startupFiles.foreign =
    [];
  sealStylesheets(octane.observation.environments[0].compiledStylesheets);
  await octane.persist();
  await assert.rejects(
    octane.read(),
    /unadmitted auxiliary compiled entrypoints/u,
  );
});

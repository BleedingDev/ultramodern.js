import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';

const root = process.cwd();
const workspace = process.argv[2];
const cliObservation = Boolean(
  process.env.ULTRAMODERN_OCTANE_OBSERVER_CONSUMER,
);
if (!cliObservation)
  assert.ok(workspace, 'Pass the actual UltraModern owning worktree path.');
const installedConsumer = process.env.ULTRAMODERN_OCTANE_OBSERVER_CONSUMER
  ? path.resolve(process.env.ULTRAMODERN_OCTANE_OBSERVER_CONSUMER)
  : process.argv[3]
    ? path.resolve(process.argv[3])
    : undefined;
const consumerRequire = installedConsumer
  ? createRequire(path.join(installedConsumer, 'package.json'))
  : createRequire(import.meta.url);
let sdkDependency;
if (installedConsumer) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(installedConsumer, 'package.json'), 'utf8'),
  );
  const declarations = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  const owners = [
    '@bleedingdev/modern-js-ultramodern-app-tools',
    '@modern-js/ultramodern-app-tools',
  ].filter(name => Object.hasOwn(declarations, name));
  assert.equal(
    owners.length,
    1,
    'The consumer must declare exactly one SDK owner.',
  );
  [sdkDependency] = owners;
}
const sdkEntry = installedConsumer
  ? consumerRequire.resolve(`${sdkDependency}/rsbuild`)
  : undefined;
const providerRequire = sdkEntry ? createRequire(sdkEntry) : consumerRequire;
const octaneProvider = providerRequire.resolve('@octanejs/rspack-plugin');
const rsbuildProvider = providerRequire.resolve('@rsbuild/core');
const { getOctaneRspackBuildInfo, inferRspackEnvironment } = await import(
  pathToFileURL(octaneProvider)
);
const { createRsbuild } = await import(pathToFileURL(rsbuildProvider));
const observationFile = path.resolve(
  process.env.ULTRAMODERN_OCTANE_OBSERVER_OUTPUT ??
    process.argv[4] ??
    path.join(root, 'plain-tsx-compiler-observation.json'),
);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let moduleIdentifiers = [];
const compilerObservations = [];

function createRspackCompilerObserver() {
  return {
    apply(compiler) {
      compiler.hooks.thisCompilation.tap(
        'admission:plain-tsx-observation',
        compilation => {
          compilation.hooks.processAssets.tap(
            {
              name: 'admission:plain-tsx-observation',
              stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
            },
            () => {
              const rows = [];
              const visit = (module, topLevelIndex, parent, inherited = []) => {
                const chunks = [
                  ...compilation.chunkGraph.getModuleChunksIterable(module),
                ];
                const ownAssets = chunks.flatMap(chunk => [...chunk.files]);
                const assets = [
                  ...new Set([...inherited, ...ownAssets]),
                ].sort();
                const native = getOctaneRspackBuildInfo(module);
                const buildInfo = module.buildInfo ?? {};
                const children = [...(module.modules ?? [])];
                const source = module.originalSource();
                rows.push({
                  topLevelIndex,
                  parent,
                  identifier: module.identifier(),
                  resource: module.resource ?? null,
                  loaders: module.loaders?.map(loader => ({
                    loader: loader.loader,
                    root: loader.options?.root,
                    environment: loader.options?.environment,
                    transpile: loader.options?.transpile,
                  })),
                  native: native ?? null,
                  rawOctaneBuildInfo: buildInfo.octane ?? null,
                  buildInfoKeys: Object.keys(buildInfo).sort(),
                  sourceSha256: buildInfo.ultramodernOctaneSourceSha256 ?? null,
                  emittedSourceSha256: source ? digest(source.buffer()) : null,
                  ownAssets,
                  inheritedAssets: inherited,
                  assets,
                  children: children.map(child => child.identifier()),
                });
                for (const child of children)
                  visit(child, topLevelIndex, module.identifier(), assets);
              };
              [...compilation.modules].forEach((module, index) =>
                visit(module, index, null),
              );
              compilerObservations.push({
                environment: inferRspackEnvironment(compiler.options.target),
                compilerContext: compiler.context,
                compilationName: compiler.options.name ?? null,
                compilationHash: compilation.hash ?? null,
                moduleCount: [...compilation.modules].length,
                nativeRows: rows.filter(row => row.native).length,
                rows,
              });
              fs.writeFileSync(
                observationFile,
                `${JSON.stringify(
                  {
                    sdkEntry: sdkEntry ?? null,
                    sdkDependency: sdkDependency ?? null,
                    rsbuildProvider,
                    octaneProvider,
                    observations: compilerObservations,
                  },
                  null,
                  2,
                )}\n`,
              );
            },
          );
        },
      );
    },
  };
}

function createCompilerObservationPlugin() {
  return {
    name: 'admission:compiled-closure',
    setup(api) {
      api.modifyRspackConfig(config => {
        config.plugins ??= [];
        config.plugins.push(createRspackCompilerObserver());
      });
      api.onAfterBuild(({ stats }) => {
        const compilations = stats.stats
          ? stats.stats.map(item => item.compilation)
          : [stats.compilation];
        moduleIdentifiers = compilations.flatMap(compilation =>
          [...compilation.modules].map(module => module.identifier()),
        );
      });
    },
  };
}

async function main() {
  if (installedConsumer) {
    const rspackRequire = createRequire(rsbuildProvider);
    const rspackManifest = JSON.parse(
      fs.readFileSync(
        rspackRequire.resolve('@rspack/core/package.json'),
        'utf8',
      ),
    );
    assert.equal(
      rspackManifest.version,
      '2.2.8',
      'The public failure requires its actual selected Rspack provider.',
    );
    const sdkNamespace = await import(pathToFileURL(sdkEntry));
    const resolveUltramodernRsbuildConfig =
      sdkNamespace.resolveUltramodernRsbuildConfig ??
      sdkNamespace.default?.resolveUltramodernRsbuildConfig;
    assert.equal(typeof resolveUltramodernRsbuildConfig, 'function');
    const { rsbuildConfig } = await resolveUltramodernRsbuildConfig({
      command: 'build',
      cwd: installedConsumer,
      configPath: path.join(installedConsumer, 'modern.config.ts'),
    });
    console.log(
      JSON.stringify({
        mode: 'installed-public-observation',
        sdkEntry,
        sdkDependency,
        rsbuildProvider,
        octaneProvider,
        rspackVersion: rspackManifest.version,
        observationFile,
      }),
    );
    const observed = await createRsbuild({
      cwd: installedConsumer,
      rsbuildConfig: {
        ...rsbuildConfig,
        plugins: [
          ...(rsbuildConfig.plugins ?? []),
          createCompilerObservationPlugin(),
        ],
      },
    });
    await observed.build();
    return;
  }
  const rsbuildDirectory = path.dirname(
    providerRequire.resolve('@rsbuild/core/package.json'),
  );
  const { createJiti } = await import(
    pathToFileURL(path.join(rsbuildDirectory, 'compiled/jiti/lib/jiti.mjs'))
  );
  // This admission lane probes owning source; packed acceptance uses shipped exports.
  const jiti = createJiti(import.meta.url, {
    tryNative: false,
    alias: {
      '@modern-js/renderer-octane/manifest': path.join(
        workspace,
        'packages/runtime/renderer-octane/src/manifest.ts',
      ),
    },
  });
  const { createOctaneCompilerPlugin } = await jiti.import(
    path.join(
      workspace,
      'packages/solutions/ultramodern-app-tools/src/renderers/octane/compiler/index.ts',
    ),
  );
  const { validateOctaneModuleManifest, octaneModuleManifestFileName } =
    await jiti.import(
      path.join(workspace, 'packages/runtime/renderer-octane/src/manifest.ts'),
    );
  // Match the public native entry's asynchronous application boundary. The
  // multi-entry baseline can expose concatenated parents before their children.
  const singleIdentity = {
    renderer: 'octane',
    appId: 'native-admission',
    entryName: 'index',
    protocolVersion: 1,
    buildId: 'admission-source-concatenation-identity',
  };
  const singleInputs = path.join(root, 'dist/compiler-concatenation-input');
  const singleOutput = path.join(root, 'dist/compiler-concatenation');
  fs.mkdirSync(singleInputs, { recursive: true });
  fs.writeFileSync(
    path.join(singleInputs, 'application.client.tsx'),
    `import App from ${JSON.stringify(path.join(root, 'src/PlainApp.tsx'))};\nexport async function loadApplication() { return { default: App }; }\n`,
  );
  fs.writeFileSync(
    path.join(singleInputs, 'index.ts'),
    `import { mountOctaneApplication } from '@modern-js/renderer-octane/client';
declare const __webpack_hash__: string;
const identity = ${JSON.stringify(singleIdentity)};
const container = document.getElementById('root');
if (!container) throw new Error('Missing native application mount');
void mountOctaneApplication({
  container,
  identity,
  nativeHydrationBuildId: __webpack_hash__,
  load: async () => {
    const application = await import('./application.client');
    return application.loadApplication();
  },
});
`,
  );
  const singleObservationStart = compilerObservations.length;
  const singleHost = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      plugins: [
        createOctaneCompilerPlugin({
          rendererIdentities: () => ({ index: singleIdentity }),
        }),
        createCompilerObservationPlugin(),
      ],
      source: { entry: { index: path.join(singleInputs, 'index.ts') } },
      output: { distPath: { root: singleOutput } },
      tools: { rspack: { optimization: { concatenateModules: true } } },
    },
  });
  await singleHost.build();
  const singleNativeBuild = JSON.parse(
    fs.readFileSync(
      path.join(singleOutput, 'octane-client-build.json'),
      'utf8',
    ),
  );
  const singleManifest = validateOctaneModuleManifest(
    JSON.parse(
      fs.readFileSync(
        path.join(singleOutput, octaneModuleManifestFileName('index')),
        'utf8',
      ),
    ),
    singleIdentity,
    singleNativeBuild.buildId,
  );
  for (const source of singleManifest.sourceModules)
    assert.equal(
      digest(
        fs.readFileSync(path.resolve(root, source.resource.split('?')[0])),
      ),
      source.sourceSha256,
    );
  for (const asset of singleManifest.assets)
    assert.equal(
      digest(fs.readFileSync(path.join(singleOutput, asset.file))),
      asset.sha256,
    );
  const singlePlainRows = compilerObservations
    .slice(singleObservationStart)
    .filter(observation => observation.environment === 'client')
    .flatMap(observation => observation.rows)
    .filter(row => row.resource === path.join(root, 'src/PlainApp.tsx'));
  const standalonePlain = singlePlainRows.find(
    row => row.parent === null && row.ownAssets.length === 0 && row.native,
  );
  assert.ok(
    standalonePlain,
    'The genuine single-entry plain component must first appear without its own chunk.',
  );
  const concatenatedPlain = singlePlainRows.find(
    row =>
      row.identifier === standalonePlain.identifier &&
      row.parent !== null &&
      row.inheritedAssets.some(file => file.endsWith('.js')),
  );
  assert.ok(
    concatenatedPlain,
    'The genuine single-entry plain component must later inherit its concatenated parent asset.',
  );
  assert.ok(standalonePlain.topLevelIndex < concatenatedPlain.topLevelIndex);
  assert.equal(standalonePlain.native.transformKind, 'compile');
  assert.equal(standalonePlain.sourceSha256, concatenatedPlain.sourceSha256);
  const singlePlainSources = singleManifest.sourceModules.filter(
    source => source.resource === 'src/PlainApp.tsx',
  );
  assert.equal(
    singlePlainSources.length,
    1,
    'Repeated graph visits must produce one single-entry source record.',
  );
  for (const asset of concatenatedPlain.inheritedAssets.filter(file =>
    file.endsWith('.js'),
  ))
    assert.ok(singlePlainSources[0].assets.includes(asset));
  const identities = Object.fromEntries(
    [
      'client',
      'router-client',
      'signals-client',
      'svg-url',
      'plain-client',
    ].map(entryName => [
      entryName,
      {
        renderer: 'octane',
        appId: 'native-admission',
        entryName,
        protocolVersion: 1,
        buildId: 'admission-source-profile-identity',
      },
    ]),
  );
  const output = path.join(root, 'dist/compiler-profile');
  const host = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      plugins: [
        createOctaneCompilerPlugin({ rendererIdentities: () => identities }),
        createCompilerObservationPlugin(),
      ],
      source: {
        entry: {
          client: './src/client.ts',
          'router-client': './src/router-client.ts',
          'signals-client': './src/signals-client.ts',
          'svg-url': './src/Svg.tsx',
          'plain-client': './src/plain-client.ts',
        },
      },
      output: {
        distPath: { root: 'dist/compiler-profile' },
        dataUriLimit: { svg: 0 },
      },
      tools: {
        rspack: { optimization: { minimize: false, concatenateModules: true } },
      },
    },
  });
  await host.build();
  assert.equal(
    moduleIdentifiers.some(id =>
      /node_modules[/\\](?:react|react-dom)(?:[/\\]|$)/u.test(id),
    ),
    false,
  );
  const nativeBuild = JSON.parse(
    fs.readFileSync(path.join(output, 'octane-client-build.json'), 'utf8'),
  );
  const manifests = Object.keys(identities).map(entryName => {
    const raw = JSON.parse(
      fs.readFileSync(
        path.join(output, octaneModuleManifestFileName(entryName)),
        'utf8',
      ),
    );
    const manifest = validateOctaneModuleManifest(
      raw,
      identities[entryName],
      nativeBuild.buildId,
    );
    for (const source of manifest.sourceModules) {
      assert.equal(
        digest(
          fs.readFileSync(path.resolve(root, source.resource.split('?')[0])),
        ),
        source.sourceSha256,
      );
    }
    for (const asset of manifest.assets) {
      assert.equal(
        digest(fs.readFileSync(path.join(output, asset.file))),
        asset.sha256,
      );
    }
    assert.throws(() =>
      validateOctaneModuleManifest(raw, {
        ...identities[entryName],
        buildId: 'stale',
      }),
    );
    assert.throws(() =>
      validateOctaneModuleManifest(
        raw,
        identities[entryName],
        'stale-native-client',
      ),
    );
    assert.throws(() =>
      validateOctaneModuleManifest(
        { ...raw, assets: [] },
        identities[entryName],
      ),
    );
    return manifest;
  });
  const plainManifest = manifests.find(
    manifest => manifest.rendererIdentity.entryName === 'plain-client',
  );
  assert.ok(plainManifest, 'Missing plain TSX component manifest.');
  assert.ok(
    plainManifest.sourceModules.some(
      source =>
        source.resource === 'src/PlainApp.tsx' &&
        source.transformKind === 'compile' &&
        source.assets.length > 0,
    ),
    'The plain TSX component itself must retain native compiler metadata and authenticated source bytes.',
  );
  assert.ok(
    manifests.some(manifest =>
      manifest.sourceModules.some(source =>
        /tanstack-router.*\.tsrx/u.test(source.resource),
      ),
    ),
  );
  assert.ok(
    fs
      .readdirSync(path.join(output, 'static/svg'))
      .some(file => file.endsWith('.svg')),
  );

  const negative = fs.mkdtempSync(path.join(root, 'compiler-negative-'));
  const rejectedTargets = [];
  const rejectedJsxTargets = [];
  try {
    fs.writeFileSync(
      path.join(negative, 'svg.ts'),
      `import value from ${JSON.stringify(path.join(root, 'src/logo.svg?component'))}; console.log(value);`,
    );
    fs.writeFileSync(
      path.join(negative, 'Card.jsx'),
      'export default function Card() { return <main />; }\n',
    );
    for (const [name, request] of [
      ['jsx', './Card.jsx'],
      ['jsx-extensionless', './Card'],
    ])
      fs.writeFileSync(
        path.join(negative, `${name}.tsx`),
        `import Card from ${JSON.stringify(request)}; console.log(Card);\n`,
      );
    for (const [name, extension, expected] of [
      ['svg', 'ts', /unsupported-renderer-capability.*SVG/u],
      [
        'jsx',
        'tsx',
        /unsupported-renderer-capability.*\.jsx source:.*Card\.jsx/u,
      ],
      [
        'jsx-extensionless',
        'tsx',
        /unsupported-renderer-capability.*\.jsx source:.*Card\.jsx/u,
      ],
    ]) {
      for (const target of ['web', 'node']) {
        let diagnostic = '';
        let compilationEnvironment;
        const rejected = await createRsbuild({
          cwd: root,
          rsbuildConfig: {
            plugins: [
              createOctaneCompilerPlugin({
                rendererIdentities: () => ({ client: identities.client }),
              }),
            ],
            source: {
              entry: { client: path.join(negative, `${name}.${extension}`) },
            },
            output: {
              target,
              distPath: { root: path.join(negative, name, target) },
            },
            tools: {
              rspack: {
                plugins: [
                  {
                    apply(compiler) {
                      compiler.hooks.done.tap(
                        'admission:rejected-compiler-diagnostic',
                        stats => {
                          compilationEnvironment = inferRspackEnvironment(
                            compiler.options.target,
                          );
                          diagnostic = stats
                            .toJson({ all: false, errors: true })
                            .errors.map(error => error.message)
                            .join('\n');
                        },
                      );
                    },
                  },
                ],
              },
            },
          },
        });
        await assert.rejects(rejected.build());
        assert.equal(
          compilationEnvironment,
          target === 'node' ? 'server' : 'client',
        );
        assert.match(diagnostic, expected);
        if (name === 'svg') rejectedTargets.push(target);
        else rejectedJsxTargets.push({ source: name, target });
      }
    }
  } finally {
    fs.rmSync(negative, { recursive: true, force: true });
  }
  const evidence = {
    actualNativeCompiler: true,
    sourceAndAssetDigests: true,
    nativeBuildIdentity: nativeBuild.buildId,
    distinctSharedBuildIdentity: identities.client.buildId,
    rawNativeRouterCompiled: true,
    plainTsxAuthenticated: true,
    concatenatedPlainTsxAuthenticated: true,
    svgUrl: true,
    svgComponentRejected: true,
    svgComponentRejectedTargets: rejectedTargets,
    unsupportedJsxRejected: true,
    unsupportedJsxRejectedTargets: rejectedJsxTargets,
    staleSharedAndNativeIdentityRejected: true,
    reactRuntimeModules: false,
    sourceModules: manifests.map(manifest => ({
      entryName: manifest.rendererIdentity.entryName,
      count: manifest.sourceModules.length,
    })),
  };
  fs.writeFileSync(
    'compiler-evidence.json',
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(JSON.stringify(evidence));
}

if (cliObservation) {
  if (isMainThread) {
    assert.ok(
      process.env.ULTRAMODERN_OCTANE_OBSERVER_OUTPUT,
      'Actual CLI observation requires an explicitly owned output path.',
    );
    const rspackRequire = createRequire(rsbuildProvider);
    const rspackProvider = rspackRequire.resolve('@rspack/core');
    const rspackManifest = JSON.parse(
      fs.readFileSync(
        rspackRequire.resolve('@rspack/core/package.json'),
        'utf8',
      ),
    );
    assert.equal(rspackManifest.version, '2.2.8');
    const { Compiler } = rspackRequire(rspackProvider);
    assert.equal(typeof Compiler?.prototype.run, 'function');
    const originalRun = Compiler.prototype.run;
    const observedCompilers = new WeakSet();
    const rspackObserver = createRspackCompilerObserver();
    Compiler.prototype.run = function (...args) {
      if (!observedCompilers.has(this)) {
        observedCompilers.add(this);
        rspackObserver.apply(this);
      }
      return Reflect.apply(originalRun, this, args);
    };
    console.log(
      JSON.stringify({
        mode: 'actual-public-cli-observation',
        sdkEntry,
        sdkDependency,
        rsbuildProvider,
        rspackProvider,
        octaneProvider,
        rspackVersion: rspackManifest.version,
        observationFile,
      }),
    );
  }
} else {
  await main();
}

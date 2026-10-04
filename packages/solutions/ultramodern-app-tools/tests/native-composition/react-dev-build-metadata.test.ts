import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  type AppNormalizedConfig,
  type AppTools,
  appTools,
  type CliPlugin,
} from '@modern-js/app-tools';
import {
  type RendererBuildIdentities,
  resolveRendererBuildIdentities,
} from '@modern-js/app-tools-extensions/renderer-build-identity';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import {
  createServerBase,
  type Middleware,
  type ServerEnv,
} from '@modern-js/server-core';
import type { Entrypoint } from '@modern-js/types';
import {
  createRsbuild,
  type OnDevCompileDoneFn,
  type RsbuildPlugin,
  type RsbuildPluginAPI,
  type Rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  RENDERER_BUILD_MANIFEST_FILE,
  RENDERER_DEVELOPMENT_DIRECTORY,
  readRendererDevelopmentBuildManifest,
} from '../../src/native-composition/native-build-manifest';
import {
  REACT_RENDERER_IDENTITY_ELEMENT_ID,
  type ReactBuildMetadataOptions,
  reactRendererBuildMetadataPlugin,
} from '../../src/native-composition/react-build-metadata';
import reactBuildMetadataServerPlugin, {
  REACT_RENDERER_IDENTITY_HEADER,
  type ReactBuildMetadataServerOptions,
} from '../../src/native-composition/react-build-metadata-server';
import { resolveRendererProfileMetadata } from '../../src/native-composition/renderer-profile';

const roots: string[] = [];
const closes: (() => Promise<void>)[] = [];
const priorNodeEnvironment = process.env.NODE_ENV;

afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
  if (priorNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorNodeEnvironment;
});

function createFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'um-real-react-dev-metadata-'),
  );
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'));
  const owner = resolveRendererProfileMetadata('react').frameworkPackages.find(
    binding => binding.specifier === '@modern-js/ultramodern-app-tools',
  )!;
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'real-react-dev-metadata',
      private: true,
      dependencies: {
        [owner.specifier]:
          owner.name === owner.specifier
            ? owner.version
            : `npm:${owner.name}@${owner.version}`,
      },
    }),
  );
  const link = path.join(root, 'node_modules', owner.specifier);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(owner.directory, link, 'dir');
  fs.writeFileSync(
    path.join(root, 'src', 'style.module.css'),
    '.selected { color: red; }\n',
  );
  for (const entry of ['ssr', 'csr'])
    fs.writeFileSync(
      path.join(root, 'src', `${entry}.js`),
      "import styles from './style.module.css'; globalThis.selected = styles.selected;\n",
    );
  return root;
}

function actualTypedCssProducer(): RsbuildPlugin {
  const require = createRequire(
    path.resolve(__dirname, '../../../../cli/builder/package.json'),
  );
  return require('@rsbuild/plugin-typed-css-modules').pluginTypedCSSModules();
}

function fixtureInventory(root: string) {
  const files: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'internal', '.git'].includes(item.name))
        continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.isFile())
        files[path.relative(root, file)] = createHash('sha256')
          .update(fs.readFileSync(file))
          .digest('hex');
    }
  };
  visit(root);
  return files;
}

async function initializeMetadata(
  root: string,
  command: 'build' | 'dev',
  cssDeclarations: boolean,
  server: boolean,
) {
  const entryNames = server ? ['ssr', 'csr'] : ['csr'];
  const metadata = resolveRendererProfileMetadata('react');
  const observed: {
    mode: 'production' | 'development';
    identities: RendererBuildIdentities;
    configuration: string;
    inventory: Record<string, string>;
    inputFiles: readonly string[];
    compilerInputs: NonNullable<
      Parameters<
        ReactBuildMetadataOptions['resolveBuildIdentities']
      >[0]['compilerInputs']
    >;
  }[] = [];
  const resolveBuildIdentities: ReactBuildMetadataOptions['resolveBuildIdentities'] =
    async context => {
      if (command === 'dev') expect(context.mode).toBe('development');
      const mode = context.mode ?? 'production';
      const { source, output, server, html, bff, deploy, experiments } =
        context.config;
      const router =
        'router' in context.config ? context.config.router : undefined;
      // Use the selected authored fields from createRendererBuildIdentityResolver.
      const configuration = JSON.parse(
        JSON.stringify({
          source,
          output,
          server,
          html,
          router,
          bff,
          deploy,
          experiments,
        }),
      );
      const inventory = fixtureInventory(root);
      const provider = {
        ...metadata.profile.router,
        framework: 'react-router' as const,
      };
      const identities = await resolveRendererBuildIdentities({
        renderer: 'react',
        profile: metadata.profile,
        mode,
        projectRoot: root,
        inputFiles: context.inputFiles,
        packageName: 'real-react-dev-metadata',
        entryNames: context.entrypoints.map(entry => entry.entryName),
        routerBindings: Object.fromEntries(
          context.entrypoints.map(entry => [
            entry.entryName,
            {
              owner: '@modern-js/plugin-router',
              evidence: 'owned-default' as const,
              defaultProvider: provider,
              providers: [provider] as const,
            },
          ]),
        ),
        excludedDirectories: [context.internalDirectory, context.distDirectory],
        configuration,
        packageResolutionRoots: [
          path.resolve(__dirname, '../../src/native-composition'),
          ...metadata.frameworkPackages.map(owner => owner.directory),
        ],
        frameworkPackages: metadata.frameworkPackages.map(owner => owner.name),
        frameworkPackageBindings: metadata.frameworkPackages,
      });
      observed.push({
        mode,
        identities,
        configuration: JSON.stringify(configuration),
        inventory,
        inputFiles: context.inputFiles ?? [],
        compilerInputs: context.compilerInputs ?? [],
      });
      return identities;
    };
  const manager = createPluginManager<CLIPluginAPI<AppTools>>();
  manager.addPlugins([
    appTools({ rendererExtensions: false, serverExtensions: false }),
    reactRendererBuildMetadataPlugin({
      resolveBuildIdentities,
    }) as unknown as CliPlugin<AppTools>,
  ]);
  const plugins = manager.getPlugins();
  const config = {
    renderer: 'react',
    source: { entriesDir: './src', mainEntryName: entryNames[0] },
    server: { ssr: server, ssrByEntries: { ssr: server, csr: false } },
    output: {
      cleanDistPath: false,
      enableCssModuleTSDeclaration: cssDeclarations,
    },
  };
  const context = await createContext<AppTools>({
    appContext: initAppContext({
      packageName: 'real-react-dev-metadata',
      configFile: false,
      command,
      appDirectory: root,
      metaName: 'modern-js',
      plugins,
    }),
    config,
    normalizedConfig: config as unknown as AppNormalizedConfig,
  });
  const api = initPluginAPI({ context, pluginManager: manager });
  context.pluginAPI = api;
  for (const plugin of plugins)
    await plugin.setup?.(api as CLIPluginAPI<AppTools>);
  api.updateAppContext({
    distDirectory: path.join(root, 'dist'),
    internalDirectory: path.join(root, 'internal'),
  });
  const resolved = await api.getHooks().modifyResolvedConfig.call({
    ...api.getNormalizedConfig(),
    builderPlugins: [],
  } as AppNormalizedConfig);
  context.normalizedConfig = resolved;
  const entrypoints: Entrypoint[] = entryNames.map(entryName => ({
    entryName,
    isMainEntry: entryName === entryNames[0],
    entry: path.join(root, 'src', `${entryName}.js`),
  }));
  const analyzed = await api.getHooks().modifyEntrypoints.call({ entrypoints });
  api.updateAppContext({
    entrypoints: analyzed.entrypoints,
    checkedEntries: entryNames,
  });
  await api.getHooks().generateEntryCode.call(analyzed);
  return {
    api,
    builderPlugins: resolved.builderPlugins as RsbuildPlugin[],
    metadata,
    observed,
  };
}

type DevReceipt = Parameters<OnDevCompileDoneFn>[0] & {
  nativeHashes: Readonly<Record<string, string>>;
  clientCompiler: Rspack.Compiler;
  entries?: NonNullable<ReactBuildMetadataServerOptions['entries']>;
  readinessError?: unknown;
};

function receiptQueue() {
  const completed: DevReceipt[] = [];
  const waiting: ((receipt: DevReceipt) => void)[] = [];
  return {
    push(receipt: DevReceipt) {
      const deliver = waiting.shift();
      if (deliver) deliver(receipt);
      else completed.push(receipt);
    },
    next(): Promise<DevReceipt> {
      const receipt = completed.shift();
      return receipt
        ? Promise.resolve(receipt)
        : new Promise(resolve => waiting.push(resolve));
    },
  };
}

function clientCompilation(stats: Rspack.Stats | Rspack.MultiStats) {
  const all = 'stats' in stats ? stats.stats : [stats];
  const client = all.find(result => result.compilation.name === 'client');
  if (!client)
    throw new Error('Actual dev stats did not include the client compilation');
  return client.compilation;
}

function actualCompilerHashes(stats: Rspack.Stats | Rspack.MultiStats) {
  return Object.fromEntries(
    ('stats' in stats ? stats.stats : [stats]).map(result => [
      result.compilation.name,
      result.compilation.hash,
    ]),
  );
}

function documentIdentity(html: string) {
  const marker = new RegExp(
    `<script\\b[^>]*\\bid=["']?${REACT_RENDERER_IDENTITY_ELEMENT_ID}["']?[^>]*>([\\s\\S]*?)<\\/script>`,
    'gu',
  );
  const matches = [...html.matchAll(marker)];
  expect(matches).toHaveLength(1);
  expect(html).not.toContain('ultramodernPendingReactIdentity');
  return JSON.parse(matches[0][1]);
}

describe('React canonical development metadata with native HMR', () => {
  it('closes the actual prepared dev compiler when startup rejects before native watch', async () => {
    const root = createFixture();
    const failure = new Error('owning prepared development graph rejected');
    let created: Rspack.Compiler | Rspack.MultiCompiler | undefined;
    const shutDown = new Set<string>();
    let prepared = 0;
    let watchRuns = 0;
    let publicCompletions = 0;
    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        mode: 'development',
        server: { host: '127.0.0.1', port: 0, printUrls: false },
        dev: { hmr: true, liveReload: false, writeToDisk: false },
        plugins: [
          {
            name: 'test-real-prepared-dev-startup-failure',
            setup(api) {
              api.onAfterCreateCompiler(({ compiler }) => {
                created = compiler;
                for (const candidate of 'compilers' in compiler
                  ? compiler.compilers
                  : [compiler]) {
                  candidate.hooks.watchRun.tap(
                    'test-no-native-watch-on-startup-failure',
                    () => {
                      watchRuns++;
                    },
                  );
                  candidate.hooks.shutdown.tapPromise(
                    'test-awaited-native-startup-shutdown',
                    async () => {
                      await Promise.resolve();
                      shutDown.add(candidate.options.name!);
                    },
                  );
                }
              });
              api.onAfterPrepareDevCompiler(({ compiler }) => {
                prepared++;
                expect(compiler).toBe(created);
                throw failure;
              });
              api.onDevCompileDone(() => {
                publicCompletions++;
              });
            },
          },
        ],
        environments: {
          client: {
            source: { entry: { csr: path.join(root, 'src', 'csr.js') } },
          },
          server: {
            source: { entry: { ssr: path.join(root, 'src', 'ssr.js') } },
            output: { target: 'node' },
          },
        },
      },
    });
    await expect(
      rsbuild.createDevServer({ getPortSilently: true }),
    ).rejects.toBe(failure);
    expect(prepared).toBe(1);
    expect(watchRuns).toBe(0);
    expect(publicCompletions).toBe(0);
    expect([...shutDown].sort()).toEqual(['client', 'server']);
  });

  it('publishes production identity from the completed client and server import graph without typed CSS', async () => {
    const root = createFixture();
    const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'um-react-imported-'));
    roots.push(shared);
    const clientInput = path.join(shared, 'client.js');
    const serverInput = path.join(shared, 'server.js');
    fs.writeFileSync(clientInput, 'export default "client-one";\n');
    fs.writeFileSync(serverInput, 'export default "server-one";\n');
    for (const entry of ['ssr', 'csr'])
      fs.writeFileSync(
        path.join(root, 'src', `${entry}.js`),
        `import value from ${JSON.stringify(clientInput)}; globalThis.clientInput = value;\n`,
      );
    const serverEntry = path.join(root, 'src', 'server.js');
    fs.writeFileSync(
      serverEntry,
      `import value from ${JSON.stringify(serverInput)}; globalThis.serverInput = value;\n`,
    );
    process.env.NODE_ENV = 'production';
    const build = async () => {
      const metadata = await initializeMetadata(root, 'build', false, true);
      expect(metadata.observed).toHaveLength(0);
      let htmlPaths: Record<string, string> = {};
      const rsbuild = await createRsbuild({
        cwd: root,
        rsbuildConfig: {
          mode: 'production',
          plugins: [
            ...metadata.builderPlugins,
            {
              name: 'test-completed-native-import-graph',
              setup(api) {
                api.onAfterCreateCompiler(({ compiler }) => {
                  for (const current of 'compilers' in compiler
                    ? compiler.compilers
                    : [compiler])
                    current.hooks.thisCompilation.tap(
                      'test-native-directory-dependencies',
                      compilation => {
                        compilation.fileDependencies.add(
                          path.join(root, 'src'),
                        );
                        compilation.fileDependencies.add(shared);
                      },
                    );
                });
                api.modifyHTMLTags((tags, { environment }) => {
                  if (environment.name === 'client')
                    htmlPaths = environment.htmlPaths;
                  return tags;
                });
                api.onAfterBuild(async params => {
                  await metadata.api.getHooks().onAfterBuild.call(params);
                });
              },
            },
          ],
          output: {
            cleanDistPath: false,
            filenameHash: false,
            distPath: { root: path.join(root, 'dist') },
          },
          performance: { printFileSize: false },
          environments: {
            client: {
              source: {
                entry: Object.fromEntries(
                  ['ssr', 'csr'].map(entry => [
                    entry,
                    path.join(root, 'src', `${entry}.js`),
                  ]),
                ),
              },
            },
            server: {
              source: { entry: { ssr: serverEntry } },
              output: {
                target: 'node',
                distPath: { root: path.join(root, 'dist', 'server') },
              },
            },
          },
        },
      });
      const built = await rsbuild.build();
      try {
        expect(metadata.observed).toHaveLength(3);
        for (const observation of metadata.observed) {
          expect(Object.isFrozen(observation.inputFiles)).toBe(true);
          expect(observation.inputFiles).toContain(clientInput);
          expect(observation.inputFiles).toContain(serverInput);
          expect(observation.inputFiles).not.toContain(path.join(root, 'src'));
          expect(observation.inputFiles).not.toContain(shared);
          expect(Object.isFrozen(observation.compilerInputs)).toBe(true);
          expect(observation.compilerInputs.every(Object.isFrozen)).toBe(true);
          expect(observation.compilerInputs).toContainEqual({
            path: path.join(root, 'src'),
            kind: 'directory',
          });
          expect(observation.compilerInputs).toContainEqual({
            path: shared,
            kind: 'directory',
          });
        }
        const manifest = JSON.parse(
          fs.readFileSync(
            path.join(root, 'dist', RENDERER_BUILD_MANIFEST_FILE),
            'utf8',
          ),
        ) as RendererBuildIdentities;
        expect(manifest.inputDigest).toBe(
          metadata.observed[0].identities.inputDigest,
        );
        for (const entry of ['ssr', 'csr'])
          expect(
            documentIdentity(
              fs.readFileSync(
                path.join(root, 'dist', htmlPaths[entry]),
                'utf8',
              ),
            ),
          ).toEqual(manifest.identities[entry]);
        return manifest;
      } finally {
        await built.close();
      }
    };
    const original = await build();
    fs.writeFileSync(serverInput, 'export default "server-two";\n');
    const changed = await build();
    expect(changed.inputDigest).not.toBe(original.inputDigest);
    expect(changed.buildMarker).not.toBe(original.buildMarker);
  }, 60_000);

  it.each([
    { cssDeclarations: false, server: true },
    { cssDeclarations: true, server: true },
    { cssDeclarations: false, server: false },
  ])('keeps one real compiler generation coherent across HMR without publishing over production, %j', async ({
    cssDeclarations,
    server,
  }) => {
    const root = createFixture();
    const entryNames = server ? ['ssr', 'csr'] : ['csr'];
    const entries = Object.fromEntries(
      entryNames.map(entryName => [
        entryName,
        path.join(root, 'src', `${entryName}.js`),
      ]),
    );
    const environments = {
      client: { source: { entry: entries } },
      ...(server
        ? {
            server: {
              source: { entry: { ssr: path.join(root, 'src/ssr.js') } },
              output: {
                target: 'node' as const,
                distPath: { root: path.join(root, 'dist', 'server') },
              },
            },
          }
        : {}),
    };
    const distDirectory = path.join(root, 'dist');
    const devDirectory = path.join(
      distDirectory,
      RENDERER_DEVELOPMENT_DIRECTORY,
    );
    const plugins = cssDeclarations ? [actualTypedCssProducer()] : [];
    process.env.NODE_ENV = 'production';
    const production = await initializeMetadata(
      root,
      'build',
      cssDeclarations,
      server,
    );
    let productionStats: Rspack.Stats | Rspack.MultiStats | undefined;
    const productionRsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        mode: 'production',
        plugins: [
          ...plugins,
          ...production.builderPlugins,
          {
            name: 'test-native-production-receipt',
            setup(api: RsbuildPluginAPI) {
              api.onAfterBuild(async params => {
                productionStats = params.stats;
                await production.api.getHooks().onAfterBuild.call(params);
              });
            },
          },
        ],
        output: {
          cleanDistPath: false,
          distPath: { root: distDirectory, js: 'bundles' },
          filenameHash: false,
        },
        performance: { printFileSize: false },
        environments,
      },
    });
    const built = await productionRsbuild.build();
    const closeProduction = () => built.close();
    closes.push(closeProduction);
    const productionManifest = fs.readFileSync(
      path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE),
    );
    const productionFiles = new Map(
      ('stats' in productionStats!
        ? productionStats.stats
        : [productionStats!]
      ).flatMap(({ compilation }) =>
        compilation.getAssets().map(({ name }) => {
          const file = path.join(compilation.outputOptions.path!, name);
          return [file, fs.readFileSync(file)] as const;
        }),
      ),
    );
    expect(productionFiles.size).toBeGreaterThan(0);
    expect([...productionFiles.keys()].some(file => file.endsWith('.js'))).toBe(
      true,
    );
    expect(
      [...productionFiles.keys()].some(file => file.endsWith('.html')),
    ).toBe(true);
    await built.close();
    closes.splice(closes.indexOf(closeProduction), 1);

    expect(process.env.NODE_ENV).toBe('production');
    const development = await initializeMetadata(
      root,
      'dev',
      cssDeclarations,
      server,
    );
    const { plugins: serverPlugins } = await development.api
      .getHooks()
      ._internalServerPlugins.call({ plugins: [] });
    const descriptor = serverPlugins.find(plugin =>
      plugin.name.endsWith('react-build-metadata-server.js'),
    )!;
    const options = descriptor.options as ReactBuildMetadataServerOptions;
    expect(options.resolveEntries).toBeTypeOf('function');
    expect(development.observed).toHaveLength(0);
    let readyBeforeCompiler = false;
    void options.resolveEntries?.().then(
      () => {
        readyBeforeCompiler = true;
      },
      () => {},
    );
    await Promise.resolve();
    expect(readyBeforeCompiler).toBe(false);
    const serializedOptions: ReactBuildMetadataServerOptions = JSON.parse(
      JSON.stringify(options),
    );
    expect(serializedOptions).toEqual({
      manifestFile: RENDERER_BUILD_MANIFEST_FILE,
      manifestMode: 'development',
    });
    const receipts = receiptQueue();
    let htmlPaths: Record<string, string> = {};
    let privateClientCompiler: Rspack.Compiler | undefined;
    let privateCompilerInputs: readonly string[] = [];
    let privateReady = false;
    const devRsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        plugins: [
          ...(cssDeclarations ? [actualTypedCssProducer()] : []),
          ...development.builderPlugins,
          {
            name: 'test-genuine-dev-completion-receipt',
            setup(api: RsbuildPluginAPI) {
              api.onAfterPrepareDevCompiler({
                order: 'post',
                handler: async ({ compiler }) => {
                  privateClientCompiler = (
                    'compilers' in compiler ? compiler.compilers : [compiler]
                  ).find(candidate => candidate.options.name === 'client');
                  expect(privateClientCompiler).toBeDefined();
                  expect(development.observed).toHaveLength(1);
                  privateCompilerInputs = development.observed[0].inputFiles;
                  expect(
                    privateCompilerInputs.some(filename =>
                      /[\\/]@rsbuild[\\/]core[\\/]dist[\\/]client[\\/]hmr\.js$/u.test(
                        filename,
                      ),
                    ),
                  ).toBe(true);
                  void options.resolveEntries!().then(
                    () => {
                      privateReady = true;
                    },
                    () => {},
                  );
                  await Promise.resolve();
                  expect(privateReady).toBe(false);
                  expect(fs.existsSync(devDirectory)).toBe(false);
                  expect(
                    fs.readFileSync(
                      path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE),
                    ),
                  ).toEqual(productionManifest);
                },
              });
              api.modifyHTMLTags((tags, { environment }) => {
                if (environment.name === 'client')
                  htmlPaths = environment.htmlPaths;
                return tags;
              });
              api.onDevCompileDone(async params => {
                const nativeHashes = Object.freeze(
                  actualCompilerHashes(params.stats),
                );
                const clientCompiler = clientCompilation(params.stats).compiler;
                try {
                  const readyEntries = await options.resolveEntries!();
                  receipts.push({
                    ...params,
                    nativeHashes,
                    clientCompiler,
                    entries: readyEntries,
                  });
                } catch (readinessError) {
                  receipts.push({
                    ...params,
                    nativeHashes,
                    clientCompiler,
                    readinessError,
                  });
                }
              });
            },
          },
        ],
        server: { host: '127.0.0.1', port: 0, printUrls: false },
        dev: { writeToDisk: false, hmr: true, liveReload: false },
        output: {
          cleanDistPath: false,
          distPath: { root: distDirectory, js: 'dev-assets', css: 'dev-css' },
          filenameHash: false,
        },
        performance: { printFileSize: false },
        environments,
      },
    });
    const devServer = await devRsbuild.createDevServer({
      getPortSilently: true,
    });
    closes.push(() => devServer.close());
    const listening = await devServer.listen();
    const address = new URL(listening.urls[0]);
    const metadataServers: ReturnType<typeof createServerBase<ServerEnv>>[] =
      [];
    for (const serverOptions of [options, serializedOptions]) {
      const metadataServer = createServerBase<ServerEnv>({
        pwd: distDirectory,
        routes: [],
        appContext: {
          appDirectory: root,
          apiDirectory: '',
          lambdaDirectory: '',
        },
        config: {
          html: {},
          output: {},
          source: {},
          tools: {},
          server: { logger: false },
          bff: {},
          dev: {},
          security: {},
        },
      });
      metadataServer.addPlugins([
        reactBuildMetadataServerPlugin(serverOptions),
        {
          name: 'test-existing-native-memory-document',
          setup(api) {
            api.onPrepare(() => {
              api.getServerContext().middlewares.push({
                name: 'test-existing-native-memory-document',
                order: 'post',
                async handler(context: Parameters<Middleware<ServerEnv>>[0]) {
                  const entryName =
                    server && !context.req.path.includes('/csr')
                      ? 'ssr'
                      : 'csr';
                  context.set('renderRoute', {
                    entryName,
                    urlPath: `/${entryName}`,
                    entryPath: htmlPaths[entryName],
                  });
                  // Expose the real compiler's memory document through the existing
                  // server response pipeline; core tests cover renderer dispatch.
                  return fetch(new URL(htmlPaths[entryName], address));
                },
              });
            });
          },
        },
      ]);
      closes.push(() => metadataServer.dispose());
      await metadataServer.init();
      metadataServers.push(metadataServer);
    }

    const assertProductionPreserved = () => {
      expect(
        fs.readFileSync(path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE)),
      ).toEqual(productionManifest);
      for (const [file, bytes] of productionFiles)
        expect(fs.readFileSync(file)).toEqual(bytes);
    };

    const checkGeneration = async (receipt: DevReceipt) => {
      expect(receipt.stats.hasErrors()).toBe(false);
      expect(receipt.readinessError).toBeUndefined();
      const manifest = await readRendererDevelopmentBuildManifest(
        distDirectory,
        development.metadata.profile,
      );
      expect(manifest.cacheAllowed).toBe(false);
      expect(manifest.promotable).toBe(false);
      expect(manifest.identities).toEqual(receipt.entries);
      expect(manifest.devCompilation.compilationHashes).toEqual(
        receipt.nativeHashes,
      );
      expect(
        Object.keys(manifest.devCompilation.compilationHashes).sort(),
      ).toEqual(server ? ['client', 'server'] : ['client']);
      expect(manifest.devCompilation.sourceInputDigest).toBe(
        development.observed.at(-1)!.identities.inputDigest,
      );
      const compilation = clientCompilation(receipt.stats);
      for (const entryName of entryNames) {
        const html = await (
          await fetch(new URL(htmlPaths[entryName], address))
        ).text();
        expect(documentIdentity(html)).toEqual(manifest.identities[entryName]);
        for (const metadataServer of metadataServers) {
          const response = await metadataServer.request(`/${entryName}`);
          expect(response.status).toBe(200);
          expect(
            JSON.parse(response.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
          ).toEqual(manifest.identities[entryName]);
          expect(documentIdentity(await response.text())).toEqual(
            manifest.identities[entryName],
          );
        }
        for (const file of compilation.entrypoints.get(entryName)!.getFiles())
          expect(fs.existsSync(path.join(distDirectory, file))).toBe(false);
      }
      assertProductionPreserved();
      return manifest;
    };

    // A failed owning pre-completion hook cannot reach the receipt callback.
    // Success still requires that actual native callback, not readiness alone.
    const [firstReceipt] = await Promise.all([
      receipts.next(),
      options.resolveEntries!(),
    ]);
    expect(firstReceipt.isFirstCompile).toBe(true);
    expect(firstReceipt.clientCompiler).toBe(privateClientCompiler);
    expect(development.observed[1].inputFiles).toEqual(privateCompilerInputs);
    expect(development.observed[1].identities).toEqual(
      development.observed[0].identities,
    );
    const first = await checkGeneration(firstReceipt);
    expect(privateReady).toBe(true);
    expect(first.devCompilation.generation).toBe(1);
    expect(first.devCompilation.sourceInputDigest).toBe(first.inputDigest);
    const nextReceipt = receipts.next();
    const editedSource = path.join(root, 'src', `${entryNames[0]}.js`);
    fs.appendFileSync(editedSource, 'globalThis.actualHotEdit = 2;\n');
    const secondReceipt = await nextReceipt;
    expect(secondReceipt.isFirstCompile).toBe(false);
    const second = await checkGeneration(secondReceipt);
    expect(secondReceipt.clientCompiler).toBe(firstReceipt.clientCompiler);
    expect(secondReceipt.nativeHashes.client).not.toBe(
      firstReceipt.nativeHashes.client,
    );
    expect(second.buildMarker).toBe(first.buildMarker);
    expect(second.inputDigest).toBe(first.inputDigest);
    expect(second.identities).toEqual(first.identities);
    expect(second.devCompilation.generation).toBe(
      first.devCompilation.generation + 1,
    );
    expect(second.devCompilation.sourceInputDigest).not.toBe(
      first.devCompilation.sourceInputDigest,
    );

    if (!cssDeclarations && server) {
      const lastAcceptedManifest = fs.readFileSync(
        path.join(devDirectory, RENDERER_BUILD_MANIFEST_FILE),
      );
      const acceptedSource = fs.readFileSync(editedSource, 'utf8');
      const errorReceipt = receipts.next();
      fs.writeFileSync(
        editedSource,
        `${acceptedSource}\nexport const broken = ;\n`,
      );
      const failed = await errorReceipt;
      expect(failed.stats.hasErrors()).toBe(true);
      expect(failed.entries).toBeUndefined();
      expect(failed.readinessError).toBeInstanceOf(Error);
      await expect(options.resolveEntries!()).rejects.toThrow();
      expect(
        (await metadataServers[0].request(`/${entryNames[0]}`)).status,
      ).toBe(500);
      expect(
        fs.readFileSync(path.join(devDirectory, RENDERER_BUILD_MANIFEST_FILE)),
      ).toEqual(lastAcceptedManifest);
      assertProductionPreserved();

      const recoveredReceipt = receipts.next();
      fs.writeFileSync(
        editedSource,
        `${acceptedSource}\nglobalThis.actualRecovery = 3;\n`,
      );
      const recovered = await recoveredReceipt;
      expect(recovered.isFirstCompile).toBe(false);
      const recovery = await checkGeneration(recovered);
      expect(recovery.buildMarker).toBe(first.buildMarker);
      expect(recovery.inputDigest).toBe(first.inputDigest);
      expect(recovery.identities).toEqual(first.identities);
      expect(recovered.clientCompiler).toBe(firstReceipt.clientCompiler);
      expect(recovery.devCompilation.generation).toBe(
        second.devCompilation.generation + 1,
      );
      expect(recovery.devCompilation.sourceInputDigest).not.toBe(
        second.devCompilation.sourceInputDigest,
      );
    }
    expect(development.observed.length).toBeGreaterThanOrEqual(4);
    expect(
      development.observed.every(
        record =>
          record.mode === 'development' &&
          !record.identities.cacheAllowed &&
          !record.identities.promotable,
      ),
    ).toBe(true);
  }, 120_000);
});

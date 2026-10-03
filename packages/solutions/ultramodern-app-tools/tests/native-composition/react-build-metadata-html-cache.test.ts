import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type AppNormalizedConfig,
  type AppTools,
  appTools,
  type CliPlugin,
} from '@modern-js/app-tools';
import { resolveRendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import { createServerBase, type ServerEnv } from '@modern-js/server-core';
import { createNodeServer } from '@modern-js/server-core/node';
import type { Entrypoint } from '@modern-js/types';
import {
  createRsbuild,
  type OnDevCompileDoneFn,
  type RsbuildPlugin,
  type Rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it } from '@rstest/core';
import {
  RENDERER_BUILD_MANIFEST_FILE,
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
  const errors: unknown[] = [];
  for (const close of closes.splice(0).reverse()) {
    try {
      await close();
    } catch (error) {
      errors.push(error);
    }
  }
  for (const root of roots.splice(0)) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (priorNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorNodeEnvironment;
  if (errors.length)
    throw new AggregateError(errors, 'Native watch cleanup failed');
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-native-html-cache-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'src'));
  const owner = resolveRendererProfileMetadata('react').frameworkPackages.find(
    binding => binding.specifier === '@modern-js/ultramodern-app-tools',
  )!;
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'native-html-cache',
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
    path.join(root, 'src/style.css'),
    '.selected { color: red; }',
  );
  fs.writeFileSync(
    path.join(root, 'src/main.js'),
    "import './style.css'; globalThis.nativeHTMLWave = 1;\n",
  );
  // A file template exercises HtmlPlugin's cache. Its generated templateContent
  // instead changes its compilation hash on every wave and never reuses HTML.
  fs.writeFileSync(
    path.join(root, 'template.html'),
    '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  );
  return root;
}

async function initializeMetadata(root: string) {
  const metadata = resolveRendererProfileMetadata('react');
  const resolveBuildIdentities: ReactBuildMetadataOptions['resolveBuildIdentities'] =
    async context => {
      expect(context.mode).toBe('development');
      const { source, output, server, html, bff, deploy, experiments } =
        context.config;
      const provider = {
        ...metadata.profile.router,
        framework: 'react-router' as const,
      };
      return resolveRendererBuildIdentities({
        renderer: 'react',
        profile: metadata.profile,
        mode: context.mode,
        projectRoot: root,
        packageName: 'native-html-cache',
        entryNames: ['main'],
        routerBindings: {
          main: {
            owner: '@modern-js/plugin-router',
            evidence: 'owned-default',
            defaultProvider: provider,
            providers: [provider],
          },
        },
        excludedDirectories: [context.internalDirectory, context.distDirectory],
        configuration: JSON.parse(
          JSON.stringify({
            source,
            output,
            server,
            html,
            bff,
            deploy,
            experiments,
          }),
        ),
        packageResolutionRoots: [
          path.resolve(__dirname, '../../src/native-composition'),
          ...metadata.frameworkPackages.map(owner => owner.directory),
        ],
        frameworkPackages: metadata.frameworkPackages.map(owner => owner.name),
        frameworkPackageBindings: metadata.frameworkPackages,
      });
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
    source: { entriesDir: './src', mainEntryName: 'main' },
    server: { ssr: false },
    output: { cleanDistPath: false, enableCssModuleTSDeclaration: false },
  };
  const context = await createContext<AppTools>({
    appContext: initAppContext({
      packageName: 'native-html-cache',
      configFile: false,
      command: 'dev',
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
  const entrypoints: Entrypoint[] = [
    {
      entryName: 'main',
      isMainEntry: true,
      entry: path.join(root, 'src/main.js'),
    },
  ];
  const analyzed = await api.getHooks().modifyEntrypoints.call({ entrypoints });
  api.updateAppContext({
    entrypoints: analyzed.entrypoints,
    checkedEntries: ['main'],
  });
  await api.getHooks().generateEntryCode.call(analyzed);
  await api
    .getHooks()
    .modifyBuilderEnvironments.call({ environments: { client: {} } });
  const { plugins: serverPlugins } = await api
    .getHooks()
    ._internalServerPlugins.call({ plugins: [] });
  const options = serverPlugins.find(plugin =>
    plugin.name.endsWith('react-build-metadata-server.js'),
  )!.options as ReactBuildMetadataServerOptions;
  return {
    builderPlugins: resolved.builderPlugins as RsbuildPlugin[],
    metadata,
    options,
  };
}

type Receipt = Parameters<OnDevCompileDoneFn>[0] & {
  finalized: Promise<{
    entries?: ReactBuildMetadataServerOptions['entries'];
    error?: unknown;
  }>;
};

function receiptQueue() {
  const completed: Receipt[] = [];
  const waiting: ((receipt: Receipt) => void)[] = [];
  return {
    push(receipt: Receipt) {
      const deliver = waiting.shift();
      if (deliver) deliver(receipt);
      else completed.push(receipt);
    },
    next(): Promise<Receipt> {
      const receipt = completed.shift();
      return receipt
        ? Promise.resolve(receipt)
        : new Promise(resolve => waiting.push(resolve));
    },
  };
}

function clientCompilation(stats: Rspack.Stats | Rspack.MultiStats) {
  const client = ('stats' in stats ? stats.stats : [stats]).find(
    result => result.compilation.name === 'client',
  );
  if (!client)
    throw new Error('Native watch did not emit a client compilation');
  return client.compilation;
}

function documentIdentity(html: string) {
  const matches = [
    ...html.matchAll(
      new RegExp(
        `<script\\b[^>]*\\bid=["']?${REACT_RENDERER_IDENTITY_ELEMENT_ID}["']?[^>]*>([\\s\\S]*?)<\\/script>`,
        'gu',
      ),
    ),
  ];
  expect(matches).toHaveLength(1);
  expect(html).not.toContain('ultramodernPendingReactIdentity');
  return JSON.parse(matches[0][1]);
}

describe('React metadata with native HTML watch caching', () => {
  it('reruns the owning HTML hook for unchanged template and asset names after a finalized wave', async () => {
    for (const restoreNativeCache of [true, false]) {
      const root = fixture();
      const template = fs.readFileSync(path.join(root, 'template.html'));
      const { builderPlugins, metadata, options } =
        await initializeMetadata(root);
      const receipts = receiptQueue();
      const tagTokens: string[] = [];
      let htmlPath = '';
      const observer: RsbuildPlugin = {
        name: 'test-native-html-watch-observer',
        setup(api) {
          api.modifyHTMLTags({
            order: 'post',
            handler(tags, { filename, environment }) {
              if (environment.name === 'client') {
                htmlPath = filename;
                const identity = [...tags.headTags, ...tags.bodyTags].filter(
                  tag => tag.attrs?.id === REACT_RENDERER_IDENTITY_ELEMENT_ID,
                );
                expect(identity).toHaveLength(1);
                tagTokens.push(String(identity[0].children));
              }
              return tags;
            },
          });
        },
      };
      const counterfactual: RsbuildPlugin = {
        name: 'test-restore-native-html-cache-counterfactual',
        setup(api) {
          // Deliberately restore the pre-fix native cache through its public
          // option chain. The owning phase, tags and native watcher stay real.
          api.modifyEnvironmentConfig({
            order: 'post',
            handler(config, { name }) {
              if (name !== 'client') return;
              const configured = config.tools.htmlPlugin;
              return {
                ...config,
                tools: {
                  ...config.tools,
                  htmlPlugin: [
                    ...(Array.isArray(configured) ? configured : [configured]),
                    { cache: true },
                  ],
                },
              };
            },
          });
        },
      };
      const rsbuild = await createRsbuild({
        cwd: root,
        rsbuildConfig: {
          plugins: [
            observer,
            ...builderPlugins,
            ...(restoreNativeCache ? [counterfactual] : []),
          ],
          environments: {
            client: {
              source: { entry: { main: path.join(root, 'src/main.js') } },
            },
          },
          html: { template: path.join(root, 'template.html') },
          tools: {
            htmlPlugin: [
              { minify: false },
              options => ({ ...options, title: 'preserved native options' }),
            ],
          },
          server: { host: '127.0.0.1', port: 0, printUrls: false },
          dev: { writeToDisk: false, hmr: false, liveReload: false },
          output: {
            cleanDistPath: false,
            distPath: { root: path.join(root, 'dist') },
            filenameHash: false,
            filename: { js: '[name].js', css: '[name].css' },
          },
          performance: { printFileSize: false },
        },
      });
      // Register before createDevServer initializes any plugins. The actual
      // owning pre hook may reject, preventing a later post receipt from running.
      rsbuild.onDevCompileDone({
        order: 'pre',
        handler(params) {
          receipts.push({
            ...params,
            finalized: options.resolveEntries!().then(
              entries => ({ entries }),
              error => ({ error }),
            ),
          });
        },
      });
      const nativeServer = await rsbuild.createDevServer({
        getPortSilently: true,
      });
      const closeNative = () => nativeServer.close();
      closes.push(closeNative);
      const listening = await nativeServer.listen();
      const address = new URL(listening.urls[0]);
      const firstReceipt = await receipts.next();
      const firstReady = await firstReceipt.finalized;
      expect(firstReady.error).toBeUndefined();
      expect(firstReceipt.stats.hasErrors()).toBe(false);
      expect(firstReceipt.isFirstCompile).toBe(true);
      const first = await readRendererDevelopmentBuildManifest(
        path.join(root, 'dist'),
        metadata.profile,
      );
      expect(first.devCompilation.generation).toBe(1);
      expect(firstReady.entries).toEqual(first.identities);
      expect(tagTokens).toHaveLength(1);
      const firstPendingSeed = tagTokens[0];
      expect(firstPendingSeed).toContain('ultramodernPendingReactIdentity');
      const firstHTML = await (await fetch(new URL(htmlPath, address))).text();
      expect(documentIdentity(firstHTML)).toEqual(first.identities.main);
      expect(firstHTML).toContain('<title>preserved native options</title>');
      expect(firstHTML).not.toContain(firstPendingSeed);
      const firstCompilation = clientCompilation(firstReceipt.stats);
      const firstHash = firstCompilation.hash;
      const filenames = firstCompilation.entrypoints
        .get('main')!
        .getFiles()
        .filter(file => /\.(js|css)$/u.test(file));
      expect(filenames.some(file => file.endsWith('.js'))).toBe(true);
      expect(filenames.some(file => file.endsWith('.css'))).toBe(true);

      const next = receipts.next();
      fs.appendFileSync(
        path.join(root, 'src/main.js'),
        'globalThis.nativeHTMLWave = 2;\n',
      );
      const secondReceipt = await next;
      const secondReady = await secondReceipt.finalized;
      const secondCompilation = clientCompilation(secondReceipt.stats);
      expect(secondReceipt.isFirstCompile).toBe(false);
      expect(secondCompilation.compiler).toBe(firstCompilation.compiler);
      expect(secondCompilation.hash).not.toBe(firstHash);
      expect(
        secondCompilation.entrypoints
          .get('main')!
          .getFiles()
          .filter(file => /\.(js|css)$/u.test(file)),
      ).toEqual(filenames);
      expect(fs.readFileSync(path.join(root, 'template.html'))).toEqual(
        template,
      );
      if (restoreNativeCache) {
        expect(tagTokens).toHaveLength(1);
        expect(String(secondReady.error)).toContain(
          'React typed CSS HTML output lost its owning metadata token',
        );
        expect(
          secondCompilation.getAsset(htmlPath)!.source.source().toString(),
        ).toContain(firstPendingSeed);
        expect(
          (
            await readRendererDevelopmentBuildManifest(
              path.join(root, 'dist'),
              metadata.profile,
            )
          ).devCompilation.generation,
        ).toBe(1);
      } else {
        expect(secondReady.error).toBeUndefined();
        expect(secondReceipt.stats.hasErrors()).toBe(false);
        expect(tagTokens).toHaveLength(2);
        const second = await readRendererDevelopmentBuildManifest(
          path.join(root, 'dist'),
          metadata.profile,
        );
        expect(secondReady.entries).toEqual(second.identities);
        expect(second.devCompilation.generation).toBe(
          first.devCompilation.generation + 1,
        );
        expect(second.devCompilation.sourceInputDigest).not.toBe(
          first.devCompilation.sourceInputDigest,
        );
        expect(second.devCompilation.compilationHashes.client).toBe(
          secondCompilation.hash,
        );
        expect(
          documentIdentity(
            await (await fetch(new URL(htmlPath, address))).text(),
          ),
        ).toEqual(second.identities.main);

        const metadataServer = createServerBase<ServerEnv>({
          pwd: path.join(root, 'dist'),
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
        closes.push(() => metadataServer.dispose());
        metadataServer.addPlugins([
          reactBuildMetadataServerPlugin({
            manifestFile: RENDERER_BUILD_MANIFEST_FILE,
            manifestMode: 'development',
          }),
          {
            name: 'test-existing-native-memory-document',
            setup(api) {
              api.onPrepare(() => {
                api.getServerContext().middlewares.push({
                  name: 'test-existing-native-memory-document',
                  order: 'post',
                  async handler(context) {
                    context.set('renderRoute', {
                      entryName: 'main',
                      urlPath: '/',
                      entryPath: htmlPath,
                    });
                    return fetch(new URL(htmlPath, address), {
                      method: context.req.method,
                    });
                  },
                });
              });
            },
          },
        ]);
        await metadataServer.init();
        const httpServer = await createNodeServer(metadataServer.handle);
        closes.push(
          () =>
            new Promise<void>((resolve, reject) =>
              httpServer.close(error => (error ? reject(error) : resolve())),
            ),
        );
        await new Promise<void>(resolve =>
          httpServer.listen(0, '127.0.0.1', resolve),
        );
        const socket = httpServer.address();
        if (!socket || typeof socket === 'string')
          throw new Error('Metadata HTTP listener has no TCP address');
        const head = await fetch(`http://127.0.0.1:${socket.port}/`, {
          method: 'HEAD',
        });
        expect(head.status).toBe(200);
        expect(
          JSON.parse(head.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
        ).toEqual(second.identities.main);
        expect(await head.text()).toBe('');
      }
      await closeNative();
      closes.splice(closes.indexOf(closeNative), 1);
    }
  }, 60_000);
});

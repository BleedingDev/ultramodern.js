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
import type { RendererBuildIdentities } from '@modern-js/app-tools-extensions/renderer-build-identity';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import { createServerBase, type ServerEnv } from '@modern-js/server-core';
import type { Entrypoint } from '@modern-js/types';
import {
  createRsbuild,
  type ModifyHTMLTagsFn,
  type RsbuildPlugin,
  type Rspack,
} from '@rsbuild/core';
import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import { tanstackRouterPlugin } from '../../../../runtime/plugin-tanstack/src/cli';
import { writeTanstackRouterTypesForEntries } from '../../../../runtime/plugin-tanstack/src/cli/artifacts';
import { withEntryMetadataRead } from '../../src/native-composition/config-read-context';
import { RENDERER_BUILD_MANIFEST_FILE } from '../../src/native-composition/native-build-manifest';
import {
  REACT_RENDERER_IDENTITY_ELEMENT_ID,
  type ReactBuildMetadataOptions,
  reactRendererBuildMetadataPlugin,
} from '../../src/native-composition/react-build-metadata';
import reactBuildMetadataServerPlugin, {
  REACT_RENDERER_IDENTITY_HEADER,
} from '../../src/native-composition/react-build-metadata-server';
import { composeReactRenderer } from '../../src/native-composition/react-composition';
import { resolveRendererProfile } from '../../src/native-composition/renderer-profile';

const fixtureRoots: string[] = [];

afterEach(() => {
  for (const root of fixtureRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'um-react-metadata-'));
  fixtureRoots.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const name of ['ssr', 'csr', 'dashboard', 'extra', 'unknown'])
    fs.writeFileSync(
      path.join(root, 'src', `${name}.js`),
      'globalThis.selected = 1;\n',
    );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'react-metadata-proof', private: true }),
  );
  return root;
}

function buildIdentities(
  entryNames = ['ssr', 'csr'],
  options: Partial<RendererBuildIdentities> = {},
): RendererBuildIdentities {
  const buildMarker = options.buildMarker ?? 'a'.repeat(64);
  const identities =
    options.identities ??
    Object.fromEntries(
      entryNames.map(entryName => [
        entryName,
        {
          renderer: 'react' as const,
          appId: 'react-metadata-proof',
          entryName,
          protocolVersion: 1 as const,
          buildId: buildMarker,
        },
      ]),
    );
  const provider = {
    ...resolveRendererProfile('react').router,
    framework: 'react-router' as const,
  };
  return {
    identities,
    buildMarker,
    sourceRevision: 'workspace',
    inputDigest: 'b'.repeat(64),
    profileDigest: 'c'.repeat(64),
    compilerDigest: 'd'.repeat(64),
    frameworkCohortDigest: 'e'.repeat(64),
    cacheAllowed: false,
    promotable: false,
    ...options,
    routerBindings:
      options.routerBindings ??
      Object.fromEntries(
        Object.keys(identities).map(entryName => [
          entryName,
          {
            owner: '@modern-js/plugin-router',
            evidence: 'owned-default' as const,
            defaultProvider: { ...provider },
            providers: [{ ...provider }] as const,
          },
        ]),
      ),
  };
}

async function initializeMetadata(
  root: string,
  options: ReactBuildMetadataOptions,
  cssDeclarations = false,
  producerPlugins: CliPlugin<AppTools>[] = [],
) {
  const manager = createPluginManager<CLIPluginAPI<AppTools>>();
  manager.addPlugins([
    appTools({ rendererExtensions: false, serverExtensions: false }),
    reactRendererBuildMetadataPlugin(options) as unknown as CliPlugin<AppTools>,
    ...producerPlugins,
  ]);
  const plugins = manager.getPlugins();
  const config = {
    renderer: 'react',
    source: { entriesDir: './src', mainEntryName: 'ssr' },
    server: { ssr: true, ssrByEntries: { ssr: true, csr: false } },
    output: {
      cleanDistPath: false,
      ...(cssDeclarations ? { enableCssModuleTSDeclaration: true } : {}),
    },
  };
  const context = await createContext<AppTools>({
    appContext: initAppContext({
      packageName: 'react-metadata-proof',
      configFile: false,
      command: 'build',
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
  return { api, context };
}

function authoredEntries(root: string): Entrypoint[] {
  return ['ssr', 'csr'].map(entryName => ({
    entryName,
    isMainEntry: entryName === 'ssr',
    entry: path.join(root, 'src', entryName, 'App.tsx'),
    internalEntry: path.join(root, 'existing-runtime', `${entryName}.tsx`),
  }));
}

async function analyzeFinalEntries(
  api: Awaited<ReturnType<typeof initializeMetadata>>['api'],
  entrypoints: Entrypoint[],
) {
  const result = await api.getHooks().modifyEntrypoints.call({ entrypoints });
  api.updateAppContext({
    entrypoints: result.entrypoints,
    checkedEntries: result.entrypoints.map(entry => entry.entryName),
  });
  await api.getHooks().generateEntryCode.call(result);
  return result;
}

async function compileMetadata(
  api: Awaited<ReturnType<typeof initializeMetadata>>['api'],
  options: {
    entryNames?: string[];
    typedCss?: boolean;
    beforeFinalize?: (
      stats: Rspack.Stats | Rspack.MultiStats,
      pass: number,
    ) => void;
    rsbuildConfig?: NonNullable<
      Parameters<typeof createRsbuild>[0]
    >['rsbuildConfig'];
  } = {},
) {
  const root = api.getAppContext().appDirectory;
  const { builderPlugins } = await api.getHooks().modifyResolvedConfig.call({
    ...api.getNormalizedConfig(),
    builderPlugins: [],
  } as AppNormalizedConfig);
  const require = createRequire(
    path.resolve(__dirname, '../../../../cli/builder/package.json'),
  );
  const htmlPaths: Record<string, string> = {};
  let compiler: Rspack.Compiler | Rspack.MultiCompiler | undefined;
  const rsbuild = await createRsbuild({
    cwd: root,
    rsbuildConfig: {
      mode: 'production',
      plugins: [
        ...(options.typedCss
          ? [
              require('@rsbuild/plugin-typed-css-modules').pluginTypedCSSModules(),
            ]
          : []),
        {
          name: 'test-native-metadata-completion',
          setup(rsbuildApi) {
            rsbuildApi.onAfterCreateCompiler(({ compiler: created }) => {
              compiler = created;
              if (options.beforeFinalize) {
                let pass = 0;
                created.hooks.done.tap(
                  { name: 'test-completed-evidence', stage: -100 },
                  stats => options.beforeFinalize?.(stats, ++pass),
                );
              }
            });
            rsbuildApi.modifyHTMLTags((tags, { environment }) => {
              if (environment.name === 'client')
                Object.assign(htmlPaths, environment.htmlPaths);
              return tags;
            });
            rsbuildApi.onAfterBuild(async ({ stats }) => {
              await api.getHooks().onAfterBuild.call(afterBuildInput(stats));
            });
          },
        },
        ...(builderPlugins as RsbuildPlugin[]),
      ],
      output: {
        cleanDistPath: false,
        distPath: { root: path.join(root, 'dist') },
      },
      performance: { printFileSize: false },
      environments: {
        client: {
          source: {
            entry: Object.fromEntries(
              (options.entryNames ?? ['ssr', 'csr']).map(name => [
                name,
                path.join(root, 'src', `${name}.js`),
              ]),
            ),
          },
        },
      },
      ...options.rsbuildConfig,
    },
  });
  let result: Awaited<ReturnType<typeof rsbuild.build>> | undefined;
  try {
    result = await rsbuild.build();
    return { htmlPaths, stats: result.stats };
  } finally {
    if (result) await result.close();
    else if (compiler)
      await new Promise<void>((resolve, reject) =>
        compiler!.close(error => (error ? reject(error) : resolve())),
      );
  }
}

async function htmlHook(
  api: Awaited<ReturnType<typeof initializeMetadata>>['api'],
) {
  const { builderPlugins } = await api.getHooks().modifyResolvedConfig.call({
    ...api.getNormalizedConfig(),
    builderPlugins: [],
  } as AppNormalizedConfig);
  const plugin = builderPlugins!.find(
    candidate =>
      (candidate as RsbuildPlugin).name === 'ultramodern:react:build-metadata',
  ) as RsbuildPlugin;
  let hook: ModifyHTMLTagsFn | undefined;
  const rsbuild = await createRsbuild({
    cwd: api.getAppContext().appDirectory,
    rsbuildConfig: {
      mode: 'production',
      source: {
        entry: {
          ssr: path.join(api.getAppContext().appDirectory, 'src/ssr.js'),
        },
      },
      plugins: [
        {
          ...plugin,
          setup(rsbuildApi) {
            return plugin.setup({
              ...rsbuildApi,
              modifyHTMLTags(callback) {
                hook = callback;
                return rsbuildApi.modifyHTMLTags(callback);
              },
            });
          },
        },
      ],
    },
  });
  await rsbuild.initConfigs();
  if (!hook) throw new Error('React metadata HTML hook was not registered');
  return hook;
}

function htmlContext(
  filename: string,
  htmlPaths: Record<string, string>,
  name = 'client',
): Parameters<ModifyHTMLTagsFn>[1] {
  return { filename, environment: { name, htmlPaths } } as never;
}

function afterBuildInput(stats?: Rspack.Stats) {
  return { stats, isFirstCompile: true, isWatch: false, environments: {} };
}

const invalidHtmlOutputs: {
  htmlPaths: Record<string, string>;
  message: string;
}[] = [
  { htmlPaths: {}, message: 'no unambiguous analyzed entry' },
  {
    htmlPaths: { ssr: 'index.html', csr: 'index.html' },
    message: 'no unambiguous analyzed entry',
  },
];

describe('React metadata in the existing CLI build hooks', () => {
  it('keeps the full native React, TanStack, BFF and federation plugin graph acyclic', () => {
    const applicationRequire = createRequire(
      path.resolve(
        __dirname,
        '../../../../../tests/integration/routes-tanstack-mf/mf-host/package.json',
      ),
    );
    const { bffPlugin } = applicationRequire('@modern-js/plugin-bff') as {
      bffPlugin(): CliPlugin<AppTools>;
    };
    const { moduleFederationPlugin } = applicationRequire(
      '@module-federation/modern-js-v3',
    ) as { moduleFederationPlugin(): CliPlugin<AppTools> };
    const consumerPlugins = [
      tanstackRouterPlugin(),
      bffPlugin(),
      moduleFederationPlugin(),
    ];
    const manager = createPluginManager<CLIPluginAPI<AppTools>>();
    manager.addPlugins([
      composeReactRenderer({ consumerPlugins }),
      ...consumerPlugins,
    ]);
    const names = manager.getPlugins().map(plugin => plugin.name);
    expect(names).toEqual(
      expect.arrayContaining([
        '@modern-js/runtime',
        '@modern-js/plugin-router',
        '@modern-js/plugin-tanstack',
        '@modern-js/plugin-analyze',
        '@modern-js/plugin-module-federation-config',
        '@modern-js/renderer-react-build-metadata',
        '@modern-js/ultramodern-react-mf-receiver-outputs',
      ]),
    );
    expect(
      names.indexOf('@modern-js/renderer-react-build-metadata'),
    ).toBeLessThan(names.indexOf('@modern-js/plugin-analyze'));
  });

  it.each([
    false,
    true,
  ])('captures exact native router producer bytes before receiver preparation; later edit=%s', async edit => {
    const root = createFixture();
    const generatedDirName = 'custom-native-router';
    const router = path.join(
      root,
      'src',
      generatedDirName,
      'ssr',
      'router.gen.ts',
    );
    fs.mkdirSync(path.dirname(router), { recursive: true });
    fs.writeFileSync(router, '// previous native generation\n');
    let produced: string | undefined;
    const resolveBuildIdentities = rstest.fn<
      ReactBuildMetadataOptions['resolveBuildIdentities']
    >(async () => {
      expect(fs.readFileSync(router, 'utf8')).toBe(produced);
      return buildIdentities();
    });
    const { api } = await initializeMetadata(
      root,
      { resolveBuildIdentities },
      false,
      [
        {
          name: '@modern-js/plugin-tanstack',
          setup(producerApi) {
            producerApi.generateEntryCode(async () => {
              await writeTanstackRouterTypesForEntries({
                appContext: producerApi.getAppContext(),
                generatedDirName,
                routesByEntry: { ssr: [], csr: [] },
              });
              produced = fs.readFileSync(router, 'utf8');
            });
          },
        },
      ],
    );
    await analyzeFinalEntries(api, authoredEntries(root));
    expect(produced).not.toBe('// previous native generation\n');
    if (edit) {
      await expect(
        compileMetadata(api, {
          beforeFinalize() {
            fs.writeFileSync(router, '// unacknowledged generated-file edit\n');
          },
        }),
      ).rejects.toThrow('authored inputs changed');
      expect(resolveBuildIdentities).not.toHaveBeenCalled();
    } else {
      await compileMetadata(api);
      expect(resolveBuildIdentities).toHaveBeenCalledTimes(3);
      expect(fs.readFileSync(router, 'utf8')).toBe(produced);
    }
  });

  it('publishes one canonical final manifest and document identity after actual typed CSS generation', async () => {
    const root = createFixture();
    fs.writeFileSync(
      path.join(root, 'src', 'style.module.css'),
      '.final { color: red; }\n',
    );
    for (const entryName of ['ssr', 'csr'])
      fs.writeFileSync(
        path.join(root, 'src', `${entryName}.js`),
        "import styles from './style.module.css'; globalThis.selected = styles.final;\n",
      );
    const resolveBuildIdentities = rstest.fn<
      ReactBuildMetadataOptions['resolveBuildIdentities']
    >(async () => {
      const declaration = fs.readFileSync(
        path.join(root, 'src', 'style.module.css.d.ts'),
      );
      return buildIdentities(['ssr', 'csr'], {
        buildMarker: createHash('sha256').update(declaration).digest('hex'),
      });
    });
    const { api } = await initializeMetadata(
      root,
      { resolveBuildIdentities },
      true,
    );
    await analyzeFinalEntries(api, authoredEntries(root));
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
    const { builderPlugins } = await api.getHooks().modifyResolvedConfig.call({
      ...api.getNormalizedConfig(),
      builderPlugins: [],
    } as AppNormalizedConfig);
    const require = createRequire(
      path.resolve(__dirname, '../../../../cli/builder/package.json'),
    );
    let clientHTMLPaths: Record<string, string> = {};
    const rsbuild = await createRsbuild({
      cwd: root,
      rsbuildConfig: {
        mode: 'production',
        plugins: [
          require('@rsbuild/plugin-typed-css-modules').pluginTypedCSSModules(),
          ...(builderPlugins as RsbuildPlugin[]),
          {
            name: 'test-existing-cli-after-build',
            setup(rsbuildApi) {
              rsbuildApi.modifyHTMLTags((tags, { environment }) => {
                if (environment.name === 'client')
                  clientHTMLPaths = environment.htmlPaths;
                return tags;
              });
              rsbuildApi.onAfterBuild(async ({ stats }) => {
                await api.getHooks().onAfterBuild.call(afterBuildInput(stats));
              });
            },
          },
        ],
        output: {
          cleanDistPath: false,
          distPath: { root: path.join(root, 'dist') },
        },
        performance: { printFileSize: false },
        environments: {
          client: {
            source: {
              entry: Object.fromEntries(
                ['ssr', 'csr'].map(name => [
                  name,
                  path.join(root, 'src', `${name}.js`),
                ]),
              ),
            },
          },
        },
      },
    });
    const result = await rsbuild.build();
    try {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(root, 'dist', RENDERER_BUILD_MANIFEST_FILE),
          'utf8',
        ),
      );
      expect(resolveBuildIdentities).toHaveBeenCalledTimes(3);
      for (const entryName of ['ssr', 'csr']) {
        const html = fs.readFileSync(
          path.join(root, 'dist', clientHTMLPaths[entryName]),
          'utf8',
        );
        expect(html).toContain(JSON.stringify(manifest.identities[entryName]));
        expect(html).not.toContain('ultramodernPendingReactIdentity');
      }
      expect(manifest.routerBindings).toEqual(buildIdentities().routerBindings);
      const { plugins } = await api
        .getHooks()
        ._internalServerPlugins.call({ plugins: [] });
      const metadata = plugins.find(plugin =>
        plugin.name.endsWith('react-build-metadata-server.js'),
      )!;
      expect(typeof metadata.options?.resolveEntries).toBe('function');
      const serialized = JSON.parse(JSON.stringify(metadata.options));
      expect(serialized).toEqual({
        manifestFile: RENDERER_BUILD_MANIFEST_FILE,
      });
      const server = createServerBase<ServerEnv>({
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
      server.addPlugins([
        reactBuildMetadataServerPlugin(serialized),
        {
          name: 'test-existing-react-response',
          setup(serverApi) {
            serverApi.onPrepare(() => {
              serverApi.getServerContext().middlewares.push({
                name: 'test-existing-react-response',
                order: 'post',
                handler(context) {
                  context.set('renderRoute', {
                    entryName: 'ssr',
                    urlPath: '/ssr',
                    entryPath: clientHTMLPaths.ssr,
                  });
                  return new Response('existing React response');
                },
              });
            });
          },
        },
      ]);
      try {
        await server.init();
        const response = await server.request('/ssr');
        expect(
          JSON.parse(response.headers.get(REACT_RENDERER_IDENTITY_HEADER)!),
        ).toEqual(manifest.identities.ssr);
        expect(await response.text()).toBe('existing React response');
      } finally {
        await server.dispose();
      }
    } finally {
      await result.close();
    }
  });
  it('keeps authored entries and existing runtime paths, then writes canonical evidence from emitted assets', async () => {
    const root = createFixture();
    const resolveBuildIdentities = rstest.fn<
      ReactBuildMetadataOptions['resolveBuildIdentities']
    >(async () => buildIdentities());
    const { api } = await initializeMetadata(root, { resolveBuildIdentities });
    const entries = authoredEntries(root);
    const result = await analyzeFinalEntries(api, entries);
    expect(result.entrypoints).toEqual(entries);
    expect(result.entrypoints[0]).toBe(entries[0]);
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
    await compileMetadata(api);
    const resolvedContext = resolveBuildIdentities.mock.calls[0][0];
    expect(resolvedContext).toEqual(
      expect.objectContaining({
        appDirectory: root,
        packageName: 'react-metadata-proof',
        entrypoints: entries,
        config: expect.objectContaining({
          server: { ssr: true, ssrByEntries: { ssr: true, csr: false } },
        }),
      }),
    );
    expect(resolvedContext.entrypoints[0]).not.toBe(entries[0]);
    expect(resolvedContext.pluginNames).toEqual(
      api.getAppContext().plugins.map(plugin => plugin.name),
    );
    expect(resolvedContext.pluginNames).toContain('@modern-js/plugin-analyze');
    expect(resolvedContext.inputFiles).toEqual(
      expect.arrayContaining([
        path.join(root, 'src', 'ssr.js'),
        path.join(root, 'src', 'csr.js'),
      ]),
    );
    expect(Object.isFrozen(resolvedContext.inputFiles)).toBe(true);
    const manifestFile = path.join(
      api.getAppContext().distDirectory,
      RENDERER_BUILD_MANIFEST_FILE,
    );
    expect(JSON.parse(fs.readFileSync(manifestFile, 'utf8'))).toEqual({
      ...buildIdentities(),
      schema: 'ultramodern-renderer-build',
      version: 1,
      profile: resolveRendererProfile('react'),
    });
    expect(resolveBuildIdentities).toHaveBeenCalledTimes(3);
    const emittedContext = resolveBuildIdentities.mock.calls[1][0];
    expect(emittedContext).not.toBe(resolvedContext);
    expect(emittedContext.entrypoints).toEqual(resolvedContext.entrypoints);
    expect(resolveBuildIdentities.mock.calls[2][0]).toBe(emittedContext);
    expect(
      fs
        .readdirSync(path.dirname(manifestFile))
        .some(name => name.endsWith('.tmp')),
    ).toBe(false);
  });

  it.each([
    'rename',
    'add',
    'remove',
  ] as const)('captures final analyzed entries after a late consumer %s hook', async change => {
    const root = createFixture();
    const resolveBuildIdentities = rstest.fn<
      ReactBuildMetadataOptions['resolveBuildIdentities']
    >(async ({ entrypoints }) =>
      buildIdentities(entrypoints.map(entry => entry.entryName)),
    );
    const { api } = await initializeMetadata(root, { resolveBuildIdentities });
    api.modifyEntrypoints(({ entrypoints }) => ({
      entrypoints:
        change === 'rename'
          ? entrypoints.map(entry =>
              entry.entryName === 'ssr'
                ? { ...entry, entryName: 'dashboard' }
                : entry,
            )
          : change === 'add'
            ? [
                ...entrypoints,
                { ...entrypoints[0], entryName: 'extra', isMainEntry: false },
              ]
            : entrypoints.filter(entry => entry.entryName !== 'csr'),
    }));
    const result = await api
      .getHooks()
      .modifyEntrypoints.call({ entrypoints: authoredEntries(root) });
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
    const finalNames = result.entrypoints.map(entry => entry.entryName);
    api.updateAppContext({
      entrypoints: result.entrypoints,
      checkedEntries: finalNames,
    });
    await api.getHooks().generateEntryCode.call(result);
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
    const { htmlPaths } = await compileMetadata(api, {
      entryNames: finalNames,
    });
    expect(
      resolveBuildIdentities.mock.calls[0][0].entrypoints.map(
        entry => entry.entryName,
      ),
    ).toEqual(finalNames);
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(
          api.getAppContext().distDirectory,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
        'utf8',
      ),
    );
    expect(Object.keys(manifest.identities)).toEqual(finalNames);
    for (const entryName of finalNames) {
      const html = fs.readFileSync(
        path.join(root, 'dist', htmlPaths[entryName]),
        'utf8',
      );
      expect(html).toContain(JSON.stringify(manifest.identities[entryName]));
      expect(html).not.toContain('ultramodernPendingReactIdentity');
    }
  });

  it('uses exact Rsbuild HTML entry metadata for nested custom-template outputs and escapes inert JSON outside the root', async () => {
    const root = createFixture();
    const initial = buildIdentities();
    const identities = {
      ...initial,
      identities: {
        ...initial.identities,
        ssr: {
          ...initial.identities.ssr,
          appId: '</script><script>alert(1)</script>\u2028\u2029',
        },
      },
    };
    const template = path.join(root, 'template.html');
    fs.writeFileSync(
      template,
      '<!doctype html><html><head></head><body><div id="root">Custom template</div></body></html>',
    );
    const { api } = await initializeMetadata(root, {
      resolveBuildIdentities: async () => identities,
    });
    await analyzeFinalEntries(api, authoredEntries(root));
    const { htmlPaths } = await compileMetadata(api, {
      rsbuildConfig: { html: { template, outputStructure: 'nested' } },
    });
    expect(htmlPaths.ssr).toBe('ssr/index.html');
    const html = fs.readFileSync(
      path.join(root, 'dist', htmlPaths.ssr),
      'utf8',
    );
    const marker = html.match(
      new RegExp(
        `<script(?=[^>]*id="${REACT_RENDERER_IDENTITY_ELEMENT_ID}")(?=[^>]*type="application/json")[^>]*>(.*?)</script>`,
        'su',
      ),
    );
    expect(marker).not.toBeNull();
    expect(html.indexOf(marker![0])).toBeGreaterThan(
      html.indexOf('Custom template</div>'),
    );
    expect(marker![1]).not.toContain('</script>');
    expect(marker![1]).not.toContain('\u2028');
    expect(marker![1]).not.toContain('\u2029');
    expect(JSON.parse(marker![1])).toEqual(identities.identities.ssr);
    expect(html).not.toContain('ultramodernPendingReactIdentity');
  });

  it.each(
    invalidHtmlOutputs,
  )('rejects an HTML output with conflicting or absent analyzed identity: $message', async ({
    htmlPaths,
    message,
  }) => {
    const root = createFixture();
    const { api } = await initializeMetadata(root, {
      resolveBuildIdentities: async () => buildIdentities(),
    });
    await analyzeFinalEntries(api, authoredEntries(root));
    const modifyHTMLTags = await htmlHook(api);
    expect(() =>
      modifyHTMLTags(
        { headTags: [], bodyTags: [] },
        htmlContext('index.html', htmlPaths),
      ),
    ).toThrow(message);
  });

  it('rejects an existing document marker and leaves non-client HTML untouched', async () => {
    const root = createFixture();
    const { api } = await initializeMetadata(root, {
      resolveBuildIdentities: async () => buildIdentities(),
    });
    await analyzeFinalEntries(api, authoredEntries(root));
    const modifyHTMLTags = await htmlHook(api);
    const tags = {
      headTags: [
        { tag: 'script', attrs: { id: REACT_RENDERER_IDENTITY_ELEMENT_ID } },
      ],
      bodyTags: [],
    };
    expect(() =>
      modifyHTMLTags(tags, htmlContext('index.html', { ssr: 'index.html' })),
    ).toThrow('Duplicate React document renderer identity');
    expect(
      await modifyHTMLTags(tags, htmlContext('index.html', {}, 'worker')),
    ).toBe(tags);
  });

  it('keeps a frozen identity snapshot when the resolver later mutates its own result', async () => {
    const root = createFixture();
    const initial = buildIdentities();
    const mutable = {
      ...initial,
      identities: {
        ssr: { ...initial.identities.ssr },
        csr: { ...initial.identities.csr },
      },
    };
    let calls = 0;
    const { api } = await initializeMetadata(root, {
      resolveBuildIdentities: async () => {
        if (++calls === 2) {
          mutable.identities.ssr.appId = 'changed after capture';
          mutable.inputDigest = 'f'.repeat(64);
        }
        return mutable;
      },
    });
    await analyzeFinalEntries(api, authoredEntries(root));
    await expect(compileMetadata(api)).rejects.toThrow(
      'changed during compilation (inputDigest)',
    );
    expect(calls).toBe(2);
    const html = fs.readFileSync(path.join(root, 'dist', 'ssr.html'), 'utf8');
    expect(html).toContain(JSON.stringify(initial.identities.ssr));
    expect(html).not.toContain('changed after capture');
    expect(
      fs.existsSync(
        path.join(
          api.getAppContext().distDirectory,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
      ),
    ).toBe(false);
  });

  it.each([
    'missing',
    'profile',
    'identity',
  ] as const)('rejects invalid saved serve evidence before resolving a server plugin: %s', async failure => {
    const root = createFixture();
    const resolveBuildIdentities = rstest.fn(async () => buildIdentities());
    const { api } = await initializeMetadata(root, { resolveBuildIdentities });
    api.updateAppContext({ command: 'serve' });
    if (failure !== 'missing') {
      const manifest = {
        ...buildIdentities(),
        schema: 'ultramodern-renderer-build',
        version: 1,
        profile: resolveRendererProfile(
          failure === 'profile' ? 'solid' : 'react',
        ),
      };
      if (failure === 'identity') {
        manifest.identities = {
          ssr: { ...manifest.identities.ssr, buildId: 'conflicting build' },
        };
        manifest.routerBindings = {
          ssr: manifest.routerBindings!.ssr,
        };
      }
      fs.mkdirSync(api.getAppContext().distDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(
          api.getAppContext().distDirectory,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
        JSON.stringify(manifest),
      );
    }
    await expect(
      api.getHooks()._internalServerPlugins.call({ plugins: [] }),
    ).rejects.toThrow(
      failure === 'missing'
        ? 'ENOENT'
        : failure === 'profile'
          ? 'profile conflicts'
          : 'identity conflicts',
    );
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
  });

  it('retains existing builder plugins and cache opt-outs while deferring cache admission until the compiler graph is known', async () => {
    const root = createFixture();
    const identities = buildIdentities(['ssr', 'csr'], {
      sourceRevision: 'f'.repeat(40),
      cacheAllowed: true,
      promotable: true,
    });
    const { api } = await initializeMetadata(root, {
      resolveBuildIdentities: async () => identities,
    });
    const existingPlugin: RsbuildPlugin = {
      name: 'existing-react-plugin',
      setup() {},
    };
    const modified = await api.getHooks().modifyResolvedConfig.call({
      ...api.getNormalizedConfig(),
      builderPlugins: [existingPlugin],
    } as AppNormalizedConfig);
    expect(modified.builderPlugins).toContain(existingPlugin);
    expect(
      modified.builderPlugins!.filter(
        plugin =>
          (plugin as RsbuildPlugin).name === 'ultramodern:react:build-metadata',
      ),
    ).toHaveLength(1);
    await analyzeFinalEntries(api, authoredEntries(root));
    const { environments } = await api
      .getHooks()
      .modifyBuilderEnvironments.call({
        environments: {
          client: {
            source: { entry: { ssr: '/authored/ssr.tsx' } },
            performance: {
              buildCache: {
                cacheDigest: ['existing'],
                cacheDirectory: '/existing/cache',
              },
            },
          },
          server: {
            performance: { buildCache: false },
            output: { target: 'node' },
          },
        },
      });
    expect(environments.client.source?.entry).toEqual({
      ssr: '/authored/ssr.tsx',
    });
    expect(environments.client.performance?.buildCache).toBe(false);
    expect(environments.server.performance?.buildCache).toBe(false);
    expect(environments.server.output?.target).toBe('node');
  });

  it('disables caches for an unpromotable workspace build', async () => {
    const root = createFixture();
    const { api } = await initializeMetadata(root, {
      resolveBuildIdentities: async () => buildIdentities(),
    });
    await analyzeFinalEntries(api, authoredEntries(root));
    const { environments } = await api
      .getHooks()
      .modifyBuilderEnvironments.call({
        environments: {
          client: { performance: { buildCache: { cacheDigest: ['old'] } } },
        },
      });
    expect(environments.client.performance?.buildCache).toBe(false);
  });

  it('does no build admission or metadata output for API-only apps', async () => {
    const root = createFixture();
    const resolveBuildIdentities = rstest.fn(async () => buildIdentities());
    const { api } = await initializeMetadata(root, { resolveBuildIdentities });
    api.updateAppContext({ apiOnly: true });
    const entries = authoredEntries(root);
    expect((await analyzeFinalEntries(api, entries)).entrypoints).toEqual(
      entries,
    );
    await api.getHooks().onAfterBuild.call(afterBuildInput());
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        path.join(
          api.getAppContext().distDirectory,
          RENDERER_BUILD_MANIFEST_FILE,
        ),
      ),
    ).toBe(false);
  });

  it('registers no compilation or HTML metadata work during an entry-metadata read', async () => {
    const root = createFixture();
    const resolveBuildIdentities = rstest.fn(async () => buildIdentities());
    const { api } = await withEntryMetadataRead(() =>
      initializeMetadata(root, { resolveBuildIdentities }),
    );
    await analyzeFinalEntries(api, authoredEntries(root));
    const config = await api.getHooks().modifyResolvedConfig.call({
      ...api.getNormalizedConfig(),
      builderPlugins: [],
    } as AppNormalizedConfig);
    expect(
      config.builderPlugins!.some(
        plugin =>
          (plugin as RsbuildPlugin).name === 'ultramodern:react:build-metadata',
      ),
    ).toBe(false);
    await api.getHooks().onAfterBuild.call(afterBuildInput());
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
  });

  it.each([
    'inputDigest',
    'compilerDigest',
    'frameworkCohortDigest',
    'buildMarker',
  ] as const)('rejects a changed %s after compilation and leaves the prior manifest intact', async field => {
    const root = createFixture();
    const initial = buildIdentities();
    const resolveBuildIdentities = rstest.fn(async () =>
      resolveBuildIdentities.mock.calls.length === 1
        ? initial
        : buildIdentities(['ssr', 'csr'], { [field]: 'f'.repeat(64) }),
    );
    const { api } = await initializeMetadata(root, { resolveBuildIdentities });
    await analyzeFinalEntries(api, authoredEntries(root));
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
    const manifestFile = path.join(
      api.getAppContext().distDirectory,
      RENDERER_BUILD_MANIFEST_FILE,
    );
    fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
    fs.writeFileSync(manifestFile, 'previous accepted bytes');
    await expect(compileMetadata(api)).rejects.toThrow(
      `changed during compilation (${field})`,
    );
    expect(resolveBuildIdentities).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(manifestFile, 'utf8')).toBe(
      'previous accepted bytes',
    );
  });

  it('rejects HTML for an entry outside the completed identity graph', async () => {
    const root = createFixture();
    const { api } = await initializeMetadata(root, {
      resolveBuildIdentities: async () => buildIdentities(),
    });
    await analyzeFinalEntries(api, authoredEntries(root));
    await expect(
      compileMetadata(api, { entryNames: ['unknown'] }),
    ).rejects.toThrow('HTML output has no final entry identity');
    expect(
      fs.existsSync(path.join(root, 'dist', RENDERER_BUILD_MANIFEST_FILE)),
    ).toBe(false);
  });

  it.each([
    'hash',
    'entry',
    'asset',
    'empty',
  ] as const)('rejects incomplete actual compilation evidence: %s', async failure => {
    const root = createFixture();
    const { api } = await initializeMetadata(root, {
      resolveBuildIdentities: async () => buildIdentities(),
    });
    await analyzeFinalEntries(api, authoredEntries(root));
    await expect(
      compileMetadata(api, {
        entryNames: failure === 'entry' ? ['ssr'] : ['ssr', 'csr'],
        beforeFinalize(stats, pass) {
          // The private discovery does not emit files. Inject an empty output
          // only after the native emitting pass creates its genuine asset.
          if (failure === 'empty' && pass === 1) return;
          const compilation = ('stats' in stats ? stats.stats : [stats]).find(
            result => result.compilation.name === 'client',
          )!.compilation;
          if (failure === 'entry') return;
          const file = compilation.entrypoints
            .get('csr')!
            .getFiles()
            .find(name => name.endsWith('.js'))!;
          expect(file).toBeDefined();
          if (failure === 'hash')
            Object.defineProperty(compilation, 'hash', { value: '' });
          if (failure === 'asset') compilation.deleteAsset(file);
          if (failure === 'empty')
            fs.writeFileSync(
              path.join(compilation.outputOptions.path!, file),
              '',
            );
        },
      }),
    ).rejects.toThrow(
      failure === 'hash'
        ? 'requires a completed client compilation'
        : failure === 'entry' || failure === 'asset'
          ? 'React application entry csr was not emitted'
          : 'missing or empty',
    );
    expect(
      fs.existsSync(path.join(root, 'dist', RENDERER_BUILD_MANIFEST_FILE)),
    ).toBe(false);
  });

  it('rejects a real compiler error without publishing renderer evidence', async () => {
    const root = createFixture();
    fs.writeFileSync(
      path.join(root, 'src', 'ssr.js'),
      'export const broken = ;',
    );
    const resolveBuildIdentities = rstest.fn(async () => buildIdentities());
    const { api } = await initializeMetadata(root, { resolveBuildIdentities });
    await analyzeFinalEntries(api, authoredEntries(root));
    await expect(compileMetadata(api)).rejects.toThrow();
    expect(resolveBuildIdentities).not.toHaveBeenCalled();
    expect(
      fs.existsSync(path.join(root, 'dist', RENDERER_BUILD_MANIFEST_FILE)),
    ).toBe(false);
  });
});

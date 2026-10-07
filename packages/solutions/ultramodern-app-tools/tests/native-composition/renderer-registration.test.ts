import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools/cli-config';
import { createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import type { RendererIdentity } from '@modern-js/renderer-core/identity';
import type { NativeRequestContext } from '@modern-js/renderer-core/server';
import { fileReader } from '@modern-js/runtime-utils/fileReader';
import type { Entrypoint } from '@modern-js/types/cli/base';
import { describe, expect, it, rstest } from '@rstest/core';
import {
  createServerBase,
  injectRenderHandlerPlugin,
  type Render,
  type RenderOptions,
  type ServerPlugin,
} from '../../../../server/core/src';
import { resolveUltramodernConfig } from '../../src/native-composition/config';
import { loadUltramodernConfigSnapshot } from '../../src/native-composition/config-evaluator';
import { defineConfig } from '../../src/native-composition/index';
import { RENDERER_BUILD_MANIFEST_FILE } from '../../src/native-composition/native-build-manifest';
import { createNativeEntryGenerator } from '../../src/native-composition/native-entry';
import { emitNativeRouteModule } from '../../src/native-composition/native-routes';
import {
  type NativeNodeBindings,
  type NativeServerPluginOptions,
  nativeServerPlugin,
} from '../../src/native-composition/native-server-plugin';
import { activateNativeRendererCompiler } from '../../src/native-composition/renderer-compiler-activation';
import {
  type RendererBuildProfile,
  resolveCandidateRendererProfile,
} from '../../src/native-composition/renderer-profile';
import {
  registeredRenderers,
  resolveNativeRendererAdapter,
  resolveRendererRegistration,
} from '../../src/native-composition/renderer-registration';
import { resolveEntrypointRouterBindings } from '../../src/native-composition/renderer-router-resolution';
import {
  assertCapturedRenderer,
  assertRendererCompilerOwnership,
  resolveRendererBuilderPlugins,
} from '../../src/native-composition/renderer-selection';
import type { RegisteredRenderer } from '../../src/native-composition/renderer-selection-metadata';
import type { UltramodernAppUserConfig } from '../../src/native-composition/types';
import { createCompilerActivationFixture } from './compiler-activation-fixture';

// Replace one owner at its existing static registration, without a runtime registry API.
rstest.mock('node:child_process', { spy: true });
rstest.mock('../../src/renderers/solid/registration', () => {
  const { createReplacementCompilerArtifacts } = rstest.requireActual<
    typeof import('./replacement-compiler-artifacts')
  >('./replacement-compiler-artifacts');
  const profile: RendererBuildProfile = {
    renderer: 'fourth-native',
    status: 'preview',
    protocolVersion: 1,
    minimumNode: '26.10.0',
    hmr: {
      editedBoundary: 'may-reset',
      unaffectedComponents: 'preserved',
      document: 'preserved',
      roots: 'single',
      cleanup: 'exactly-once',
    },
    compiler: { name: 'fourth-compiler', version: '1.0.0' },
    hydration: { name: 'fourth-runtime', version: '1.0.0' },
    router: {
      name: '@fixture/fourth-router',
      version: '1.0.0',
      coreName: '@tanstack/router-core',
      coreVersion: '1.171.34',
    },
    sourceExtensions: ['.tsx', '.ts'],
    jsxImportSource: 'fourth-runtime',
    dependencies: {},
    capabilities: {
      worker: false,
      moduleFederation: false,
      rsc: false,
      ssg: false,
      i18n: true,
      svgComponent: false,
    },
  };
  const routerFrameworks = ['fourth-router'];
  const compilerArtifacts = {
    ...createReplacementCompilerArtifacts(),
    routerFrameworks,
  };
  const generator = {
    client: () => 'fourth.client.ts',
    server: () => 'fourth.server.ts',
  };
  return {
    solidRendererRegistration: {
      renderer: profile.renderer,
      kind: 'native',
      candidateProfile: profile,
      routerFrameworks,
      frameworkModules: [],
      supports: {
        reactCliPlugins: false,
        reactRuntimeDescriptors: false,
        reactCompiler: false,
        cssDeclarations: false,
      },
      nativeAdapter: {
        renderer: profile.renderer,
        infrastructurePluginName: '@fixture/fourth-native-infrastructure',
        profile,
        compilerArtifacts,
        compiler: Object.freeze({
          schema: 'ultramodern-native-compiler-activation',
          version: 1,
          renderer: profile.renderer,
          operation: 'compiler',
          module: Object.freeze({
            source: './src/renderers/fourth-native/compiler/index.ts',
            import:
              './dist/esm-node/renderers/fourth-native/compiler/index.mjs',
            require: './dist/cjs/renderers/fourth-native/compiler/index.js',
          }),
          export: 'createFixtureCompiler',
        }),
        createEntryGenerator: () => generator,
        emitRouteModule: (options: {
          mode: string;
          basePath: string;
          routes: unknown[];
        }) =>
          `fourth-route:${options.mode}:${options.basePath}:${options.routes.length}`,
      },
    },
  };
});

// The spy loads the real dispatcher graph after the replacement owner is installed.
rstest.mock('../../src/native-composition/renderer-compiler-activation', {
  spy: true,
});

const renderer = 'fourth-native' as RegisteredRenderer;

describe('static renderer owner admission', () => {
  it('records the fourth router adapter owner and rejects a manufactured plugin name', async () => {
    const adapter = resolveNativeRendererAdapter(renderer);
    const entrypoints: Entrypoint[] = [
      {
        entryName: 'main',
        entry: '/fixture/src/App.tsx',
        isMainEntry: true,
      },
    ];
    const metadata = { profile: adapter.profile, frameworkPackages: [] };
    const bindings = await resolveEntrypointRouterBindings(
      renderer,
      entrypoints,
      ['@fixture/fourth-native-infrastructure'],
      metadata,
    );
    expect(bindings.main.owner).toBe('@fixture/fourth-native-infrastructure');
    expect(bindings.main.defaultProvider.framework).toBe('fourth-router');
    expect(bindings.main.providers[0].framework).toBe('fourth-router');
    await expect(
      resolveEntrypointRouterBindings(
        renderer,
        entrypoints,
        ['@modern-js/renderer-fourth-native-infrastructure'],
        metadata,
      ),
    ).rejects.toThrow('The fourth-native entry router owner is not registered');
  });

  it('selects the replacement owner through config, profile, entry and route boundaries', async () => {
    const config = await resolveUltramodernConfig(defineConfig({ renderer }), {
      env: 'test',
      command: 'build',
    });
    const selected = resolveRendererRegistration(renderer);
    const adapter = resolveNativeRendererAdapter(renderer);
    expect(config.renderer).toBe(renderer);
    const selectedPlugins = config.plugins![0].usePlugins!;
    const stamp = selectedPlugins.find(
      plugin => plugin.name === '@modern-js/renderer-build-artifact-stamp',
    )!;
    expect(
      selectedPlugins.some(
        plugin => plugin.name === adapter.infrastructurePluginName,
      ),
    ).toBe(true);
    expect(stamp.pre).toEqual([adapter.infrastructurePluginName]);
    expect(stamp.required).toEqual([adapter.infrastructurePluginName]);
    expect(registeredRenderers).toContain(renderer);
    expect(resolveCandidateRendererProfile(renderer)).toEqual(adapter.profile);
    expect(selected.candidateProfile.renderer).toBe(renderer);
    expect(createNativeEntryGenerator(renderer)).toBe(
      adapter.createEntryGenerator(),
    );
    expect(
      emitNativeRouteModule({
        renderer,
        mode: 'server',
        basePath: '/catalog',
        routes: [],
      }),
    ).toBe('fourth-route:server:/catalog:0');
  });

  it('delegates the selected owner to the fixed dispatcher and its Node factory', async () => {
    const config = await resolveUltramodernConfig(defineConfig({ renderer }), {
      env: 'test',
      command: 'build',
    });
    const fixture = await createCompilerActivationFixture({
      renderers: [renderer],
    });
    const compiler = rstest.mocked(activateNativeRendererCompiler);
    compiler.mockClear();
    compiler.mockImplementationOnce((selected, options) =>
      fixture.activate(selected, options),
    );
    try {
      let transform:
        | ((
            config: UltramodernAppUserConfig,
          ) => Promise<UltramodernAppUserConfig>)
        | undefined;
      const base = config.plugins![0];
      await base.setup?.({
        modifyResolvedConfig(callback: typeof transform) {
          transform = callback;
        },
        _internalRuntimePlugins() {},
      } as unknown as Parameters<NonNullable<CliPlugin<AppTools>['setup']>>[0]);
      const selected = await transform!(config);
      expect(compiler).toHaveBeenCalledTimes(1);
      expect(compiler).toHaveBeenCalledWith(renderer, {
        rendererIdentities: expect.any(Function),
      });
      expect(fixture.calls()).toEqual([
        { renderer, format: 'import', action: 'loaded' },
        { renderer, format: 'import', action: 'factory' },
      ]);
      const owned = await resolveRendererBuilderPlugins(
        selected.builderPlugins ?? [],
      );
      expect(assertRendererCompilerOwnership(renderer, owned)).toMatchObject({
        renderer,
      });
      expect(owned.map(plugin => plugin.name)).toContain(
        'fixture:fourth-native:compiler',
      );
      expect(() => assertRendererCompilerOwnership(renderer, [])).toThrow(
        'exactly one matching native compiler owner',
      );
      expect(() =>
        assertRendererCompilerOwnership(renderer, [
          ...owned,
          owned.find(
            plugin => plugin.name === 'fixture:fourth-native:compiler',
          )!,
        ]),
      ).toThrow('exactly one matching native compiler owner');
    } finally {
      compiler.mockClear();
      fixture.cleanup();
    }
  });

  it('consumes the registered fourth artifact owner from a production CLI server descriptor', async () => {
    const root = fs.mkdtempSync(
      path.join(process.env.OWNED_TEMP_DIR ?? os.tmpdir(), 'um-fourth-server-'),
    );
    let runtime: ReturnType<typeof createServerBase> | undefined;
    const files = rstest
      .spyOn(fileReader, 'readFile')
      .mockImplementation(async filename => {
        try {
          if (!fs.statSync(filename).isFile()) return null;
          return fs.readFileSync(filename, 'utf8');
        } catch (error) {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            (error.code === 'ENOENT' || error.code === 'ENOTDIR')
          )
            return null;
          throw error;
        }
      });
    try {
      const sdkRoot = path.resolve(import.meta.dirname, '../..');
      const sdkName = JSON.parse(
        fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'),
      ).name as string;
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          name: 'fourth-server-fixture',
          version: '1.0.0',
          dependencies: { [sdkName]: 'workspace:*' },
        }),
      );
      const sdkSlot = path.join(root, 'node_modules', sdkName);
      fs.mkdirSync(path.dirname(sdkSlot), { recursive: true });
      fs.symlinkSync(sdkRoot, sdkSlot, 'dir');
      const config = await resolveUltramodernConfig(
        defineConfig({ renderer }),
        { env: 'production', command: 'serve' },
      );
      const adapter = resolveNativeRendererAdapter(renderer);
      const infrastructure = config.plugins![0].usePlugins!.find(
        plugin => plugin.name === adapter.infrastructurePluginName,
      )!;
      const identity: RendererIdentity = {
        renderer,
        appId: 'fourth-server-fixture',
        entryName: 'main',
        protocolVersion: 1,
        buildId: 'a'.repeat(64),
      };
      const entrypoints: Entrypoint[] = [
        {
          entryName: 'main',
          entry: path.join(root, 'src/App.tsx'),
          isMainEntry: true,
        },
      ];
      const routerBindings = await resolveEntrypointRouterBindings(
        renderer,
        entrypoints,
        [adapter.infrastructurePluginName],
      );
      const distDirectory = path.join(root, 'dist');
      fs.mkdirSync(distDirectory);
      fs.writeFileSync(
        path.join(distDirectory, RENDERER_BUILD_MANIFEST_FILE),
        JSON.stringify({
          schema: 'ultramodern-renderer-build',
          version: 2,
          renderer,
          profile: resolveCandidateRendererProfile(renderer),
          entries: { main: identity },
          routerBindings,
          buildId: identity.buildId,
          sourceRevision: 'workspace',
        }),
      );
      const manager = createPluginManager();
      manager.addPlugins([infrastructure]);
      const context = await createContext({
        appContext: initAppContext({
          packageName: 'fourth-server-fixture',
          configFile: false,
          command: 'serve',
          appDirectory: root,
          metaName: 'modern-js',
          plugins: manager.getPlugins(),
        }),
        config,
        normalizedConfig: config,
      });
      const api = initPluginAPI({ context, pluginManager: manager });
      context.pluginAPI = api;
      api.updateAppContext({ distDirectory, entrypoints });
      await infrastructure.setup?.(
        api as unknown as Parameters<
          NonNullable<CliPlugin<AppTools>['setup']>
        >[0],
      );
      const emitted = await api
        .getHooks()
        ._internalServerPlugins.call({ plugins: [] });
      const descriptor = emitted.plugins[0];
      expect(descriptor.name).toBe(`${sdkName}/native-server-plugin`);
      const options = descriptor.options as NativeServerPluginOptions;
      expect(options.renderer).toBe(renderer);
      expect(Object.hasOwn(options, 'compilerArtifacts')).toBe(false);
      expect(options.nativeManifestFiles).toEqual({
        main: 'compiled-artifacts/main.replacement.json',
      });
      const manifestFile = path.join(
        distDirectory,
        options.nativeManifestFiles!.main,
      );
      fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
      fs.writeFileSync(
        manifestFile,
        JSON.stringify({
          abi: 'replacement-compiler/v1',
          build: { identity, hydrationBuildId: 'fourth-hydration' },
        }),
      );
      fs.writeFileSync(
        path.join(distDirectory, 'renderer-assets.json'),
        JSON.stringify({
          schema: 'ultramodern-renderer-assets',
          version: 1,
          renderer,
          entries: {
            main: {
              rendererIdentity: identity,
              assets: [
                { kind: 'script', href: '/assets/main.js', type: 'module' },
              ],
            },
          },
        }),
      );
      let render: Render | undefined;
      const capture: ServerPlugin = {
        name: 'fourth-server-capture',
        pre: [
          '@modern-js/native-node-dispatch',
          '@modern-js/native-node-terminal-responses',
        ],
        setup(serverApi) {
          serverApi.onPrepare(() => {
            render = serverApi.getServerContext().render;
          });
        },
      };
      runtime = createServerBase({
        pwd: distDirectory,
        appContext: { appDirectory: root },
        routes: [
          {
            urlPath: '/',
            entryName: 'main',
            entryPath: 'main.html',
            bundle: 'bundles/main.mjs',
            isSSR: true,
          },
        ],
        config: {
          html: {},
          output: { distPath: { root: 'dist' } },
          source: {},
          tools: {},
          server: { logger: false, ssr: true },
          bff: {},
          dev: {},
          security: {},
        },
      });
      runtime.addPlugins([
        injectRenderHandlerPlugin({}),
        nativeServerPlugin(options),
        capture,
      ]);
      await runtime.init();
      const handler = rstest.fn(
        (
          _request: Request,
          requestContext: NativeRequestContext<NativeNodeBindings>,
        ) => Response.json(requestContext.nativeManifest),
      );
      const requestOptions: RenderOptions = {
        monitors: {
          push() {},
          error() {},
          warn() {},
          debug() {},
          info() {},
          trace() {},
          timing() {},
          counter() {},
        },
        templates: {},
        serverManifest: {},
        matchEntryName: 'main',
        loaderContext: new Map(),
      };
      Object.defineProperty(requestOptions.serverManifest, 'renderBundles', {
        value: {
          main: { rendererIdentity: identity, nativeRequestHandler: handler },
        },
        enumerable: true,
      });
      const response = await render!(
        new Request('http://fourth.invalid/'),
        requestOptions,
      );
      expect(await response.json()).toEqual({
        abi: 'replacement-compiler/v1',
        build: { identity, hydrationBuildId: 'fourth-hydration' },
      });
      expect(files).toHaveBeenCalledWith(manifestFile);
      expect(handler).toHaveBeenCalledTimes(1);
      fs.writeFileSync(
        manifestFile,
        JSON.stringify({
          abi: 'replacement-compiler/v1',
          build: {
            identity: { ...identity, buildId: 'foreign-build' },
            hydrationBuildId: 'fourth-hydration',
          },
        }),
      );
      await expect(
        render!(new Request('http://fourth.invalid/'), requestOptions),
      ).rejects.toThrow('conflicts with the application build');
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      await runtime?.dispose();
      files.mockRestore();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('admits the same fourth owner over evaluator IPC and rejects an unregistered token or router policy', async () => {
    const root = fs.mkdtempSync(
      path.join(
        process.env.OWNED_TEMP_DIR ?? os.tmpdir(),
        'um-fourth-evaluator-',
      ),
    );
    const fork = rstest.mocked(childProcess.fork);
    const originalNodeOptions = process.env.NODE_OPTIONS;
    delete process.env.NODE_OPTIONS;
    try {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'fourth-evaluator-fixture', version: '1.0.0' }),
      );
      for (const [selectedToken, framework, accepted] of [
        [renderer, 'fourth-router', true],
        ['fourth-nativ', 'fourth-router', false],
        [renderer, 'octane', false],
      ] as const) {
        const provider = {
          ...resolveCandidateRendererProfile(renderer).router,
          framework,
        };
        fork.mockImplementation(() => {
          const child: EventEmitter & {
            stdout: EventEmitter;
            stderr: EventEmitter;
            kill(): boolean;
            send(): boolean;
          } = Object.assign(new EventEmitter(), {
            stdout: new EventEmitter(),
            stderr: new EventEmitter(),
            kill() {
              queueMicrotask(() => child.emit('close', 0, null));
              return true;
            },
            send() {
              queueMicrotask(() => {
                child.emit('message', {
                  kind: 'result',
                  result: {
                    renderer: selectedToken,
                    entries: [{ entryName: 'main', isMainEntry: true }],
                    primaryEntryName: 'main',
                    routerBindings: {
                      main: {
                        owner: 'fourth-router-owner',
                        evidence: 'owned-default',
                        defaultProvider: provider,
                        providers: [provider],
                      },
                    },
                    consumedSourceInputs: {
                      kind: 'observed-config-source-inputs',
                      version: 1,
                      observations: [],
                      packageMetadata: [],
                    },
                  },
                });
                child.emit('close', 0, null);
              });
              return true;
            },
          });
          return child as unknown as childProcess.ChildProcess;
        });
        const result = loadUltramodernConfigSnapshot({
          appDirectory: root,
          env: 'test',
          command: 'build',
        });
        if (accepted) expect((await result).renderer).toBe(renderer);
        else await expect(result).rejects.toThrow('invalid metadata');
      }
    } finally {
      fork.mockRestore();
      if (originalNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = originalNodeOptions;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the selected owner capabilities when admitting authored config', () => {
    expect(() =>
      assertCapturedRenderer(
        { renderer, i18n: { locale: 'en' } } as UltramodernAppUserConfig,
        renderer,
      ),
    ).not.toThrow();
    expect(() =>
      assertCapturedRenderer({ renderer, server: { rsc: true } }, renderer),
    ).toThrow('does not support React Server Components');
  });

  it.each([
    'solid',
    'fourth-nativ',
    'vue',
    'Fourth-native',
    'fourth/native',
    '',
  ])('rejects unregistered or malformed %s before composition', value => {
    expect(() => resolveRendererRegistration(value)).toThrow(
      `Unsupported UltraModern renderer: ${value}`,
    );
    expect(() =>
      defineConfig({ renderer: value as RegisteredRenderer }),
    ).toThrow(`Unsupported UltraModern renderer: ${value}`);
  });
});

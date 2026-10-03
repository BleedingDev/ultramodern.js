import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppTools, CliPlugin } from '@modern-js/app-tools';
import { type CLIPluginAPI, createPluginManager } from '@modern-js/plugin';
import {
  createContext,
  createLoadedConfig,
  initAppContext,
  initPluginAPI,
} from '@modern-js/plugin/cli';
import type { Renderer } from '@modern-js/renderer-core';
import {
  createRsbuild,
  type RsbuildPlugin,
  type RsbuildPlugins,
} from '@rsbuild/core';
import { describe, expect, it, rstest } from '@rstest/core';
import {
  createDefineConfig,
  resolveUltramodernConfig,
} from '../../src/native-composition/config';
import {
  assertRendererCompilerOwnership,
  attachRendererCompilerClaim,
  nativeRendererIsolationPlugin,
  type RendererCompilerClaim,
  rendererSelectionGuard,
  resolveRendererBuilderPlugins,
  ULTRAMODERN_BASE_PLUGIN,
} from '../../src/native-composition/renderer-selection';
import type { UltramodernAppUserConfig } from '../../src/native-composition/types';

function compiler(renderer: 'solid' | 'octane', name = `fixture:${renderer}`) {
  return attachRendererCompilerClaim(
    { name, setup() {} },
    {
      renderer,
      sourceExtensions: ['.tsx'],
      transform: 'native',
      refresh: 'native',
      svg: 'url',
    },
  );
}

describe('native compiler ownership', () => {
  it('resolves promised and nested plugins in order, skips disabled values, and preserves the native claim', async () => {
    const first: RsbuildPlugin = { name: 'fixture:first', setup() {} };
    const native = compiler('solid');
    const last: RsbuildPlugin = { name: 'fixture:last', setup() {} };
    const plugins: RsbuildPlugins = [
      first,
      false,
      Promise.resolve([undefined, [Promise.resolve(native), null]]),
      [false, Promise.resolve(last)],
    ];
    const resolved = await resolveRendererBuilderPlugins(plugins);
    expect(resolved).toEqual([first, native, last]);
    expect(resolved[1]).toBe(native);
    expect(assertRendererCompilerOwnership('solid', resolved)?.renderer).toBe(
      'solid',
    );
  });

  it('propagates a rejected promised plugin', async () => {
    await expect(
      resolveRendererBuilderPlugins([
        Promise.reject(new Error('Compiler plugin failed to load')),
      ]),
    ).rejects.toThrow('Compiler plugin failed to load');
  });
  it.each([
    'solid',
    'octane',
  ] as const)('accepts one complete %s ownership claim', renderer => {
    const plugin = compiler(renderer);
    const claim = assertRendererCompilerOwnership(renderer, [plugin]);
    expect(claim).toEqual({
      renderer,
      sourceExtensions: ['.tsx'],
      transform: 'native',
      refresh: 'native',
      svg: 'url',
    });
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim?.sourceExtensions)).toBe(true);
  });

  it.each([
    'solid',
    'octane',
  ] as const)('rejects missing, duplicate, and mismatched owners for %s', renderer => {
    const other = renderer === 'solid' ? 'octane' : 'solid';
    const expected = `Renderer ${renderer} requires exactly one matching native compiler owner`;
    expect(() => assertRendererCompilerOwnership(renderer, [])).toThrow(
      expected,
    );
    expect(() =>
      assertRendererCompilerOwnership(renderer, [compiler(other)]),
    ).toThrow(expected);
    expect(() =>
      assertRendererCompilerOwnership(renderer, [
        compiler(renderer, 'first'),
        compiler(renderer, 'second'),
      ]),
    ).toThrow(expected);
  });

  it('rejects native owners in React configuration and a second claim on one plugin', () => {
    const plugin = compiler('solid');
    expect(
      assertRendererCompilerOwnership('react', [
        { name: 'fixture:ordinary', setup() {} },
      ]),
    ).toBeUndefined();
    expect(() => assertRendererCompilerOwnership('react', [plugin])).toThrow(
      'React configuration contains a native compiler owner',
    );
    expect(() =>
      attachRendererCompilerClaim(plugin, {
        renderer: 'solid',
        sourceExtensions: ['.jsx'],
        transform: 'native',
        refresh: 'native',
        svg: 'url',
      }),
    ).toThrow('already owns a source transform');
  });

  it.each([
    { renderer: 'react' },
    { transform: 'react' },
    { refresh: 'none' },
    { svg: 'component' },
    { sourceExtensions: [] },
    { sourceExtensions: ['tsx'] },
  ])('rejects incomplete or incompatible claims: %j', invalid => {
    const claim = {
      renderer: 'solid',
      sourceExtensions: ['.tsx'],
      transform: 'native',
      refresh: 'native',
      svg: 'url',
      ...invalid,
    };
    expect(() =>
      attachRendererCompilerClaim(
        { name: 'fixture:invalid', setup() {} },
        claim as RendererCompilerClaim,
      ),
    ).toThrow('Invalid native renderer compiler ownership claim');
  });

  it.each([
    'solid',
    'octane',
  ] as const)('removes global React transforms before %s Rsbuild plugin setup', async renderer => {
    const isolation: RsbuildPlugin = nativeRendererIsolationPlugin(renderer);
    const forbiddenSetup = rstest.fn(() => {
      throw new Error('A removed React transform reached setup');
    });
    const nativeSetup = rstest.fn();
    const native = attachRendererCompilerClaim(
      { name: `fixture:${renderer}:compiler`, setup: nativeSetup },
      {
        renderer,
        sourceExtensions: ['.tsx'],
        transform: 'native',
        refresh: 'native',
        svg: 'url',
      },
    );
    const rsbuild = await createRsbuild({
      cwd: __dirname,
      rsbuildConfig: {
        source: { entry: { main: './plain-owning-host.js' } },
        tools: { htmlPlugin: false },
        plugins: [
          { name: 'rsbuild:react', setup: forbiddenSetup },
          { name: 'rsbuild:svgr', setup: forbiddenSetup },
          { name: 'builder-plugin-adapter-modern-ssr', setup: forbiddenSetup },
          isolation,
          native,
        ],
      },
    });
    await rsbuild.initConfigs();
    expect(forbiddenSetup).not.toHaveBeenCalled();
    expect(nativeSetup).toHaveBeenCalledTimes(1);
  });
});

async function initializeSelection(config: UltramodernAppUserConfig) {
  const pluginManager = createPluginManager();
  pluginManager.addPlugins(config.plugins ?? []);
  const plugins = pluginManager.getPlugins();
  const context = await createContext({
    appContext: initAppContext({
      packageName: 'renderer-selection-owning-host',
      configFile: false,
      command: 'build',
      appDirectory: __dirname,
      metaName: 'modern-js',
      plugins,
    }),
    config,
    normalizedConfig: config,
  });
  const api = initPluginAPI({ context, pluginManager });
  context.pluginAPI = api;
  for (const plugin of plugins)
    await plugin.setup?.(api as unknown as CLIPluginAPI<AppTools>);
  return { api, context, plugins };
}

async function selectHost(
  renderer: Renderer,
  selected: CliPlugin<AppTools>,
  consumers: CliPlugin<AppTools>[] = [],
  verifyCompilerOwnership = false,
) {
  return resolveUltramodernConfig(
    createDefineConfig((captured, consumerPlugins) => ({
      name: ULTRAMODERN_BASE_PLUGIN,
      usePlugins: [
        selected,
        rendererSelectionGuard(
          captured,
          [selected],
          consumerPlugins,
          verifyCompilerOwnership,
        ),
      ],
    }))({ renderer, plugins: consumers }),
    { env: 'test', command: 'build' },
  );
}

describe('renderer guard in the owning plugin manager', () => {
  it('orders the guard before nested selected plugins and consumer setup', async () => {
    const events: string[] = [];
    const nested = {
      name: 'fixture:selected-nested',
      setup() {
        events.push('selected-nested');
      },
    };
    const selected = {
      name: 'fixture:selected-host',
      usePlugins: [nested],
      setup() {
        events.push('selected');
      },
    };
    const consumer = {
      name: 'fixture:consumer',
      setup() {
        events.push('consumer');
      },
    };
    const config = await selectHost('solid', selected, [consumer]);
    const { plugins } = await initializeSelection(config);
    const names = plugins.map(plugin => plugin.name);
    expect(
      names.indexOf('@modern-js/renderer-selection'),
    ).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('@modern-js/renderer-selection')).toBeLessThan(
      names.indexOf(nested.name),
    );
    expect(names.indexOf('@modern-js/renderer-selection')).toBeLessThan(
      names.indexOf(consumer.name),
    );
    expect(events).toEqual(['selected-nested', 'selected', 'consumer']);
  });

  it.each([
    'local',
    'programmatic',
  ] as const)('rejects a raw %s renderer override before selected setup', async override => {
    const selectedSetup = rstest.fn();
    const selected = { name: 'fixture:selected-host', setup: selectedSetup };
    const original = await selectHost('solid', selected);
    const appDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'um-renderer-override-'),
    );
    try {
      fs.writeFileSync(
        path.join(appDirectory, 'package.json'),
        JSON.stringify({ name: 'renderer-override-host' }),
      );
      fs.writeFileSync(
        path.join(appDirectory, 'modern.config.js'),
        "module.exports = { renderer: 'solid' };\n",
      );
      if (override === 'local') {
        fs.writeFileSync(
          path.join(appDirectory, 'modern.config.local.js'),
          "module.exports = { renderer: 'octane' };\n",
        );
      }
      const loaded = await createLoadedConfig<UltramodernAppUserConfig>(
        appDirectory,
        path.join(appDirectory, 'modern.config.js'),
        override === 'programmatic' ? { renderer: 'octane' } : undefined,
        { env: 'development', command: 'dev' },
      );
      const merged = {
        ...original,
        ...loaded.config,
        plugins: original.plugins,
      };
      await expect(initializeSelection(merged)).rejects.toThrow(
        'Renderer changed from solid to octane after plugin selection',
      );
      expect(selectedSetup).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(appDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a late resolved renderer change before any selected output hook', async () => {
    const output = rstest.fn();
    const selected: CliPlugin<AppTools> = {
      name: 'fixture:selected-host',
      setup(api) {
        api.onPrepare(output);
      },
    };
    const consumer: CliPlugin<AppTools> = {
      name: 'fixture:late-consumer',
      setup(api) {
        api.modifyResolvedConfig(config => ({ ...config, renderer: 'octane' }));
      },
    };
    const config = await selectHost('solid', selected, [consumer]);
    const { api, context } = await initializeSelection(config);
    context.normalizedConfig = await api
      .getHooks()
      .modifyResolvedConfig.call(config);
    await expect(api.getHooks().onPrepare.call()).rejects.toThrow(
      'Renderer changed from solid to octane after plugin selection',
    );
    expect(output).not.toHaveBeenCalled();
  });

  it.each([
    { renderer: 'solid', ownership: 'missing' },
    { renderer: 'solid', ownership: 'duplicate' },
    { renderer: 'solid', ownership: 'mismatch' },
    { renderer: 'octane', ownership: 'missing' },
    { renderer: 'octane', ownership: 'duplicate' },
    { renderer: 'octane', ownership: 'mismatch' },
  ] as const)('rejects $ownership compiler ownership before $renderer output', async ({
    renderer,
    ownership,
  }) => {
    const output = rstest.fn();
    const config = await selectHost(
      renderer,
      {
        name: 'fixture:selected-host',
        setup(api) {
          api.onPrepare(output);
        },
      },
      [],
      true,
    );
    config.builderPlugins =
      ownership === 'missing'
        ? []
        : ownership === 'duplicate'
          ? [compiler(renderer, 'first'), compiler(renderer, 'second')]
          : [compiler(renderer === 'solid' ? 'octane' : 'solid')];
    const { api } = await initializeSelection(config);
    await expect(api.getHooks().onPrepare.call()).rejects.toThrow(
      `Renderer ${renderer} requires exactly one matching native compiler owner`,
    );
    expect(output).not.toHaveBeenCalled();
  });

  it.each([
    'solid',
    'octane',
  ] as const)('permits selected %s output with exactly one matching compiler owner', async renderer => {
    const output = rstest.fn();
    const config = await selectHost(
      renderer,
      {
        name: 'fixture:selected-host',
        setup(api) {
          api.onPrepare(output);
        },
      },
      [],
      true,
    );
    config.builderPlugins = [compiler(renderer)];
    const { api } = await initializeSelection(config);
    await api.getHooks().onPrepare.call();
    expect(output).toHaveBeenCalledTimes(1);
  });

  it.each([
    'solid',
    'octane',
  ] as const)('resolves async nested %s ownership before selected output', async renderer => {
    const output = rstest.fn();
    const config = await selectHost(
      renderer,
      {
        name: 'fixture:selected-host',
        setup(api) {
          api.onPrepare(output);
        },
      },
      [],
      true,
    );
    config.builderPlugins = [
      false,
      Promise.resolve([undefined, [Promise.resolve(compiler(renderer)), null]]),
    ];
    const { api } = await initializeSelection(config);
    await api.getHooks().onPrepare.call();
    expect(output).toHaveBeenCalledTimes(1);
  });

  it.each([
    'solid',
    'octane',
  ] as const)('rejects duplicate async nested %s owners before output', async renderer => {
    const output = rstest.fn();
    const config = await selectHost(
      renderer,
      {
        name: 'fixture:selected-host',
        setup(api) {
          api.onPrepare(output);
        },
      },
      [],
      true,
    );
    config.builderPlugins = [
      Promise.resolve(compiler(renderer, 'first')),
      [false, Promise.resolve([compiler(renderer, 'second')])],
    ];
    const { api } = await initializeSelection(config);
    await expect(api.getHooks().onPrepare.call()).rejects.toThrow(
      `Renderer ${renderer} requires exactly one matching native compiler owner`,
    );
    expect(output).not.toHaveBeenCalled();
  });

  it('rejects a second raw base even when the actual manager deduplicates its name', async () => {
    const selectedSetup = rstest.fn();
    const config = await selectHost('octane', {
      name: 'fixture:selected-host',
      setup: selectedSetup,
    });
    const warn = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    config.plugins?.push({ name: ULTRAMODERN_BASE_PLUGIN });
    await expect(initializeSelection(config)).rejects.toThrow(
      'Exactly one UltraModern base composition is required',
    );
    expect(warn).toHaveBeenCalled();
    expect(selectedSetup).not.toHaveBeenCalled();
  });

  it('rejects a missing base before the selected host setup', async () => {
    const selectedSetup = rstest.fn();
    const config = await selectHost('solid', {
      name: 'fixture:selected-host',
      setup: selectedSetup,
    });
    config.plugins = config.plugins?.[0].usePlugins;
    await expect(initializeSelection(config)).rejects.toThrow(
      'Exactly one UltraModern base composition is required',
    );
    expect(selectedSetup).not.toHaveBeenCalled();
  });

  it.each([
    'solid',
    'octane',
  ] as const)('rejects registered React CLI plugins before %s host setup', async renderer => {
    const selectedSetup = rstest.fn();
    const reactSetup = rstest.fn();
    const config = await selectHost(
      renderer,
      { name: 'fixture:selected-host', setup: selectedSetup },
      [{ name: '@modern-js/plugin-ssr', setup: reactSetup }],
    );
    await expect(initializeSelection(config)).rejects.toThrow(
      `Renderer ${renderer} cannot register React CLI plugins`,
    );
    expect(selectedSetup).not.toHaveBeenCalled();
    expect(reactSetup).not.toHaveBeenCalled();
  });

  it.each([
    'solid',
    'octane',
  ] as const)('rejects RSC config before %s host setup', async renderer => {
    const selectedSetup = rstest.fn();
    const config = await selectHost(renderer, {
      name: 'fixture:selected-host',
      setup: selectedSetup,
    });
    config.server = { rsc: true };
    await expect(initializeSelection(config)).rejects.toThrow(
      'unsupported-renderer-capability',
    );
    expect(selectedSetup).not.toHaveBeenCalled();
  });

  it.each(
    (['solid', 'octane'] as const).flatMap(renderer =>
      [
        {
          capability: 'SVG components',
          unsupported: { output: { svgDefaultExport: 'component' } },
        },
        {
          capability: 'source-adjacent CSS declarations',
          unsupported: { output: { enableCssModuleTSDeclaration: true } },
        },
        {
          capability: 'runtime i18n',
          unsupported: { runtime: { i18n: { locale: 'en' } } },
        },
        { capability: 'i18n', unsupported: { i18n: { locale: 'en' } } },
        { capability: 'SSG', unsupported: { output: { ssg: true } } },
        {
          capability: 'entry SSG',
          unsupported: { output: { ssgByEntries: { main: true } } },
        },
        {
          capability: 'worker SSR',
          unsupported: { deploy: { target: 'node', worker: { ssr: true } } },
        },
        {
          capability: 'worker provider',
          unsupported: { deploy: { target: 'cloudflare' } },
        },
        {
          capability: 'Module Federation',
          unsupported: { moduleFederation: { name: 'fixture' } },
        },
        {
          capability: 'Module Federation SSR',
          unsupported: { server: { ssr: { moduleFederationAppSSR: true } } },
        },
        {
          capability: 'React compiler',
          unsupported: { source: { reactCompiler: true } },
        },
      ].map(testCase => ({ renderer, ...testCase })),
    ),
  )('rejects $capability before $renderer host setup', async ({
    renderer,
    unsupported,
  }) => {
    const selectedSetup = rstest.fn();
    const config = await selectHost(renderer, {
      name: 'fixture:selected-host',
      setup: selectedSetup,
    });
    Object.assign(config, unsupported);
    await expect(initializeSelection(config)).rejects.toThrow(
      'unsupported-renderer-capability',
    );
    expect(selectedSetup).not.toHaveBeenCalled();
  });
});

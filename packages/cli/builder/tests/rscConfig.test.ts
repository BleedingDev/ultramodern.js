import { createRsbuild, type RsbuildPlugin, type Rspack } from '@rsbuild/core';
import { describe, expect, it } from '@rstest/core';
import {
  createRscLayerMatchers,
  getRscPlugins,
  pluginRscConfig,
} from '../src/plugins/rscConfig';

describe('getRscPlugins', () => {
  const internalDir = '/tmp/internal';

  it('returns no plugins when RSC is disabled', async () => {
    const plugins = await getRscPlugins(false, internalDir);
    expect(plugins).toHaveLength(0);
  });

  it('returns the RSC plugins when enabled (default environments)', async () => {
    const plugins = await getRscPlugins(true, internalDir);
    expect(plugins).toHaveLength(2);
    expect(plugins.map(p => p.name)).toContain('builder:rsc-config');
  });

  it('accepts a custom environments mapping without throwing', async () => {
    const plugins = await getRscPlugins(true, internalDir, {
      server: 'Server',
      client: 'Render',
    });
    expect(plugins).toHaveLength(2);
    expect(plugins.map(p => p.name)).toContain('builder:rsc-config');
  });

  it('rejects empty configured environment names', async () => {
    expect(() => pluginRscConfig({ server: ' ' })).toThrow(
      'RSC server environment must have a nonempty name',
    );
    await expect(
      getRscPlugins(true, internalDir, { client: '' }),
    ).rejects.toThrow('RSC client environment must have a nonempty name');
    expect(await getRscPlugins(false, internalDir, { server: '' })).toEqual([]);
  });

  it.each([
    {
      internalDir: '/repo/node_modules/.modern-js',
      route: '/repo/node_modules/.modern-js/loader/routes.server.js',
    },
    {
      internalDir: String.raw`C:\repo\node_modules\.modern-js`,
      route: String.raw`C:\repo\node_modules\.modern-js\loader\routes.server.js`,
    },
  ])(
    'classifies generated conventional routes as RSC modules',
    ({ internalDir, route }) => {
      const matchers = createRscLayerMatchers(internalDir);
      expect(matchers.some(matcher => matcher.test(route))).toBe(true);
    },
  );

  it('keeps the TanStack render tree in SSR while isolating its data modules in RSC', () => {
    const matchers = createRscLayerMatchers('/repo/node_modules/.modern-js');
    expect(
      matchers.some(matcher =>
        matcher.test(
          '/repo/node_modules/.modern-js/index/tanstack-routes.server.js',
        ),
      ),
    ).toBe(false);
    expect(
      matchers.some(matcher =>
        matcher.test(
          '/repo/node_modules/.modern-js/index/__rsc_route_data__/loader_0.js',
        ),
      ),
    ).toBe(true);
  });

  it('keeps server-loader route data modules in the SSR layer', () => {
    const matchers = createRscLayerMatchers('/repo/node_modules/.modern-js');
    expect(
      matchers.some(matcher =>
        matcher.test(
          '/repo/src/loader/routes/redirect/page.data.ts?loaderId=loader_3&action=false&inline=true',
        ),
      ),
    ).toBe(false);
    expect(
      matchers.some(matcher =>
        matcher.test(
          '/repo/node_modules/.modern-js/loader/route-server-loaders.js',
        ),
      ),
    ).toBe(false);
  });
});

describe('RSC configured environment compiler configuration', () => {
  async function initialize(
    environments?: Parameters<typeof pluginRscConfig>[0],
  ) {
    const { Layers } = await import('rsbuild-plugin-rsc');
    const plugins = await getRscPlugins(true, '/tmp/internal', environments);
    const restoreWorkerTarget: RsbuildPlugin = {
      name: 'test:rsc-worker-environment',
      setup(api) {
        // The platform restores its ESM target after native RSC defaults.
        api.modifyEnvironmentConfig({
          order: 'post',
          handler(config, { name, mergeEnvironmentConfig }) {
            if (name === 'workerSSR') {
              return mergeEnvironmentConfig(config, {
                output: { target: 'web', module: true },
              });
            }
          },
        });
      },
    };
    const rsbuild = await createRsbuild({
      rsbuildConfig: {
        mode: 'production',
        plugins: [...plugins, restoreWorkerTarget],
        source: {
          entry: {
            main: 'data:text/javascript,export%20default%2042',
          },
        },
        environments: {
          server: { output: { target: 'node' } },
          workerSSR: { output: { target: 'web', module: true } },
          client: { output: { target: 'web' } },
          background: { output: { target: 'web-worker' } },
        },
      },
    });
    const configs = await rsbuild.initConfigs();
    const get = (name: string) => {
      const config = configs.find(config => config.name === name);
      if (!config) throw new Error(`Missing compiler environment ${name}`);
      return config;
    };
    return { get, Layers };
  }

  function entry(
    config: Rspack.Configuration,
    entryName = 'main',
  ): Rspack.EntryDescription {
    if (
      !config.entry ||
      typeof config.entry !== 'object' ||
      Array.isArray(config.entry)
    )
      throw new Error('Missing static compiler entry');
    const main = config.entry[entryName];
    if (!main) throw new Error('Missing compiler entry description');
    if (typeof main === 'string' || Array.isArray(main))
      return { import: main };
    return main;
  }

  function rules(config: Rspack.Configuration) {
    return (config.module?.rules ?? []).filter(
      (rule): rule is Rspack.RuleSetRule =>
        typeof rule === 'object' && rule !== null,
    );
  }

  function injectsBrowserEntry(config: Rspack.Configuration) {
    const imports = entry(config).import;
    return (Array.isArray(imports) ? imports : [imports]).some(
      source =>
        typeof source === 'string' &&
        source.startsWith('data:') &&
        decodeURIComponent(source).includes('window.__MODERN_JS_ENTRY_NAME'),
    );
  }

  function expectServer(
    config: Rspack.Configuration,
    layers: { ssr: string; rsc: string },
    nativeRscEnvironment = true,
  ) {
    expect(entry(config).layer).toBe(layers.ssr);
    expect(config.resolve?.alias).toMatchObject({
      '@modern-js/render/rsc$': '@modern-js/render/rsc-worker',
    });
    const configuredRules = rules(config);
    expect(JSON.stringify(configuredRules)).toContain(
      'rsc-server-entry-loader',
    );
    expect(configuredRules.some(rule => rule.layer === 'rsc-common')).toBe(
      true,
    );
    const rscRule = configuredRules.find(rule => rule.layer === layers.rsc);
    if (nativeRscEnvironment) {
      expect(Array.isArray(rscRule?.exclude)).toBe(true);
      expect(
        Array.isArray(rscRule?.exclude) &&
          rscRule.exclude.some(
            exclude =>
              exclude instanceof RegExp &&
              exclude.test('universal/async_storage'),
          ),
      ).toBe(true);
    }
    expect(injectsBrowserEntry(config)).toBe(false);
  }

  it('applies native server layers and storage isolation to the mapped web target without browser globals', async () => {
    const { get, Layers } = await initialize({
      server: 'workerSSR',
      client: 'client',
    });
    expect(get('workerSSR').target).toEqual(expect.arrayContaining(['web']));
    expectServer(get('workerSSR'), Layers);
    expectServer(get('server'), Layers, false);
    expect(injectsBrowserEntry(get('client'))).toBe(true);
    expect(injectsBrowserEntry(get('background'))).toBe(false);
    expect(entry(get('client')).layer).toBeUndefined();
    expect(entry(get('background')).layer).toBeUndefined();
  });

  it('preserves default Node and browser roles without guessing workerSSR as the RSC server', async () => {
    const { get, Layers } = await initialize();
    expectServer(get('server'), Layers);
    expect(injectsBrowserEntry(get('client'))).toBe(true);
    expect(injectsBrowserEntry(get('background'))).toBe(false);
    expect(entry(get('workerSSR')).layer).toBeUndefined();
    expect(injectsBrowserEntry(get('workerSSR'))).toBe(true);
  });
});

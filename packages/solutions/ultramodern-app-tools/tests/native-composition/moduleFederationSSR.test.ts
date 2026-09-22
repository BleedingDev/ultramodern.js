import { createRsbuild, type RsbuildPlugin } from '@rsbuild/core';
import ssrPlugin from '../../../../runtime/plugin-runtime/src/cli/ssr';
import {
  shouldUseModuleFederationNodeOutput,
  ultramodernSSRIntegrationPlugin,
} from '../../src/native-composition/ssr-integration-plugin';

type PlainObject = Record<string, any>;

const deepMerge = <T extends PlainObject>(
  target: T,
  source: PlainObject,
): T => {
  const result = { ...target } as PlainObject;

  Object.keys(source).forEach(key => {
    const sourceValue = source[key];
    const targetValue = result[key];
    const shouldDeepMerge =
      sourceValue &&
      targetValue &&
      typeof sourceValue === 'object' &&
      typeof targetValue === 'object' &&
      !Array.isArray(sourceValue) &&
      !Array.isArray(targetValue);

    result[key] = shouldDeepMerge
      ? deepMerge(targetValue, sourceValue)
      : sourceValue;
  });

  return result as T;
};

const createEnvironmentConfigTransformer = ({
  outputModule = true,
  normalizedConfig = {
    server: {
      ssr: {
        mode: 'stream',
      },
    },
  },
}: {
  outputModule?: boolean;
  normalizedConfig?: Record<string, any>;
} = {}) => {
  const builderPlugins = createBuilderPlugins(outputModule, normalizedConfig);
  const transformers: ((config: any, utils: any) => any)[] = [];
  for (const plugin of builderPlugins) {
    plugin.setup({
      modifyEnvironmentConfig: (handler: (config: any, utils: any) => any) => {
        transformers.push(handler);
      },
    } as any);
  }

  return (environmentConfig: any, name = 'server') => {
    return transformers.reduce(
      (config, transform) =>
        transform(config, {
          name,
          mergeEnvironmentConfig: (base: any, next: any) =>
            deepMerge(base, next),
        }),
      environmentConfig,
    );
  };
};

const createBuilderPlugins = (
  outputModule: boolean,
  normalizedConfig: Record<string, any>,
): RsbuildPlugin[] => {
  const plugins: RsbuildPlugin[] = [];
  const api = {
    getAppContext: () => ({
      moduleType: outputModule ? 'module' : 'commonjs',
      metaName: 'modern',
      appDirectory: '/app',
      entrypoints: [],
    }),
    getNormalizedConfig: () => normalizedConfig,
    config: (factory: () => any) => plugins.push(...factory().builderPlugins),
  };
  ssrPlugin().setup(api as any);
  ultramodernSSRIntegrationPlugin().setup(api as any);
  return plugins;
};
describe('module federation SSR output compatibility', () => {
  afterEach(() => {
    delete process.env.MF_SSR_PRJ;
    delete process.env.MODERN_MF_APP_SSR_REQUIRE_EXPLICIT;
  });

  it.each([
    {
      label: 'no markers on a plain node target',
      input: { output: { target: 'node' } },
      expected: false,
    },
    {
      label: 'a runtime source define marker',
      input: {
        output: { target: 'node' },
        source: { define: { REMOTE_IP_STRATEGY: '"inherit"' } },
      },
      expected: true,
    },
    {
      label: 'a node-prefixed target with a source define marker',
      input: {
        output: { target: 'node18' },
        source: { define: { REMOTE_IP_STRATEGY: '"inherit"' } },
      },
      expected: true,
    },
    {
      label: 'a module federation rspack plugin instance',
      input: {
        output: { target: 'node' },
        tools: {
          rspack: {
            plugins: [new (class ModuleFederationPlugin {})()],
          },
        },
      },
      expected: true,
    },
  ])('detects module federation markers: $label', ({ input, expected }) => {
    expect(shouldUseModuleFederationNodeOutput(input as any)).toBe(expected);
  });

  it('detects module federation via the MF_SSR_PRJ environment marker', () => {
    process.env.MF_SSR_PRJ = 'true';
    expect(
      shouldUseModuleFederationNodeOutput({
        output: { target: 'node' },
      }),
    ).toBe(true);
  });

  it('does not force async-node commonjs output from runtime markers alone for module federation server builds', () => {
    const warnSpy = rs.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const transform = createEnvironmentConfigTransformer();
      const result = transform({
        output: {
          target: 'node',
        },
        source: {
          define: {
            REMOTE_IP_STRATEGY: '"inherit"',
          },
        },
      });

      expect(result.output.module).toBe(true);
      expect(result.output.target).toBe('node');
      expect(result.source?.define?.['process.env.MODERN_MF_APP_SSR']).toBe(
        JSON.stringify('false'),
      );
      expect(result.splitChunks).toBe(false);
      expect(result.tools?.bundlerChain).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails fast when explicit mf ssr flag is required but missing', () => {
    process.env.MODERN_MF_APP_SSR_REQUIRE_EXPLICIT = 'true';

    const transform = createEnvironmentConfigTransformer({
      normalizedConfig: {
        server: {
          ssr: {
            mode: 'stream',
          },
        },
      },
    });

    expect(() =>
      transform({
        output: {
          target: 'node',
        },
        source: {
          define: {
            REMOTE_IP_STRATEGY: '"inherit"',
          },
        },
      }),
    ).toThrow('MODERN_MF_APP_SSR_REQUIRE_EXPLICIT=true');
  });

  it('keeps esm node output when app-level mf ssr stable flag is enabled', () => {
    const transform = createEnvironmentConfigTransformer({
      normalizedConfig: {
        server: {
          ssr: {
            mode: 'stream',
            moduleFederationAppSSR: true,
          },
        },
      },
    });

    const result = transform({
      output: {
        target: 'node',
      },
    });

    expect(result.output.module).toBe(true);
    expect(result.output.target).toBe('node');
    expect(result.source?.define?.['process.env.MODERN_MF_APP_SSR']).toBe(
      JSON.stringify('true'),
    );
    expect(result.tools?.bundlerChain).toBeUndefined();
  });

  it('preserves false opt-outs and entry-specific SSR capabilities', () => {
    for (const [server, expected] of [
      [{ ssr: false }, false],
      [{ ssr: { moduleFederationAppSSR: false } }, false],
      [{ ssrByEntries: { main: { moduleFederationAppSSR: true } } }, true],
    ] as const) {
      const result = createEnvironmentConfigTransformer({
        normalizedConfig: { server },
      })({ output: { target: 'node' } });
      expect(result.source.define['process.env.MODERN_MF_APP_SSR']).toBe(
        JSON.stringify(String(expected)),
      );
      if (expected) expect(result.splitChunks).toBe(false);
      else expect(result.splitChunks).toBeUndefined();
    }
  });
});

describe('native Rsbuild SSR composition', () => {
  it.each([
    {
      name: 'server',
      target: 'node',
      outputModule: false,
      expectedModule: false,
    },
    {
      name: 'server',
      target: 'node',
      outputModule: true,
      expectedModule: true,
    },
    // The Cloudflare builder converts its workerSSR environment to the web target.
    {
      name: 'workerSSR',
      target: 'web',
      outputModule: false,
      expectedModule: true,
    },
    {
      name: 'client',
      target: 'web',
      outputModule: true,
      expectedModule: false,
    },
  ] as const)('runs native SSR before fork policy for $name module=$outputModule', async ({
    name,
    target,
    outputModule,
    expectedModule,
  }) => {
    const normalizedConfig = {
      deploy: { target: 'cloudflare' },
      server: {
        ssr: { mode: 'stream', moduleFederationAppSSR: true },
        rsc: true,
      },
    };
    const [native, fork] = createBuilderPlugins(outputModule, normalizedConfig);
    const observed: Array<Record<string, any>> = [];
    const observedNative: RsbuildPlugin = {
      ...native,
      setup(api) {
        native.setup({
          ...api,
          modifyEnvironmentConfig(handler: any) {
            api.modifyEnvironmentConfig(async (config, utils) => {
              const result = await handler(config, utils);
              observed.push({
                module: result.output.module,
                marker: result.source.define?.['process.env.MODERN_MF_APP_SSR'],
                rsc: result.source.define?.__MODERN_ENABLE_RSC__,
              });
              return result;
            });
          },
        });
      },
    };
    const rsbuild = await createRsbuild({
      rsbuildConfig: {
        mode: 'production',
        plugins: [fork, observedNative],
        environments: {
          [name]: {
            source: { entry: { main: './src/index.ts' } },
            output: { target },
          },
        },
      },
    });
    await rsbuild.initConfigs();
    const result = rsbuild.getNormalizedConfig().environments[name];
    expect(observed).toEqual([
      {
        module: name !== 'client' && outputModule,
        marker: undefined,
        rsc: 'true',
      },
    ]);
    expect(result.output.module).toBe(expectedModule);
    expect(result.output.target).toBe(target);
    expect(result.source.define).toMatchObject({
      __MODERN_ENABLE_RSC__: 'true',
      'process.env.MODERN_ENABLE_RSC': 'true',
      'process.env.MODERN_MF_APP_SSR': JSON.stringify('true'),
      'process.env.MODERN_TARGET': JSON.stringify(
        name === 'client' ? 'browser' : 'node',
      ),
    });
    if (name !== 'client') expect(result.splitChunks).toBe(false);
    else expect(result.splitChunks).not.toBe(false);
  });
});

import ssrPlugin, {
  shouldUseModuleFederationNodeOutput,
} from '../../src/cli/ssr';

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
  let configFactory: (() => any) | undefined;
  const plugin = ssrPlugin();

  plugin.setup({
    getAppContext: () => ({
      moduleType: outputModule ? 'module' : 'commonjs',
      metaName: 'modern',
      appDirectory: '/app',
      entrypoints: [],
    }),
    getNormalizedConfig: () => normalizedConfig,
    config: (factory: () => any) => {
      configFactory = factory;
    },
  } as any);

  const config = configFactory?.();
  const builderPlugin = config?.builderPlugins?.[0];
  let transformer: ((config: any, utils: any) => any) | undefined;

  builderPlugin.setup({
    modifyEnvironmentConfig: (handler: (config: any, utils: any) => any) => {
      transformer = handler;
    },
  });

  return (environmentConfig: any, name = 'server') => {
    if (!transformer) {
      throw new Error('Expected environment transformer to be registered.');
    }

    return transformer(environmentConfig, {
      name,
      mergeEnvironmentConfig: (base: any, next: any) => deepMerge(base, next),
    });
  };
};

describe('module federation SSR output compatibility', () => {
  afterEach(() => {
    delete process.env.MF_SSR_PRJ;
  });

  it('detects module federation markers', () => {
    expect(
      shouldUseModuleFederationNodeOutput({
        output: { target: 'node' },
      }),
    ).toBe(false);

    expect(
      shouldUseModuleFederationNodeOutput({
        output: { target: 'node' },
        source: {
          define: {
            REMOTE_IP_STRATEGY: '"inherit"',
          },
        },
      }),
    ).toBe(true);

    process.env.MF_SSR_PRJ = 'true';
    expect(
      shouldUseModuleFederationNodeOutput({
        output: { target: 'node' },
      }),
    ).toBe(true);
  });

  it('detects module federation rspack plugin shape', () => {
    class ModuleFederationPlugin {}

    expect(
      shouldUseModuleFederationNodeOutput({
        output: { target: 'node' },
        tools: {
          rspack: {
            plugins: [new ModuleFederationPlugin()],
          },
        },
      }),
    ).toBe(true);
  });

  it('keeps esm output for non-mf node server builds', () => {
    const transform = createEnvironmentConfigTransformer();
    const result = transform({
      output: {
        target: 'node',
      },
    });

    expect(result.output.module).toBe(true);
    expect(result.output.target).toBe('node');
    expect(result.tools?.bundlerChain).toBeUndefined();
  });

  it('forces async-node commonjs output through bundler chain for module federation server builds', () => {
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

    expect(result.output.module).toBe(false);
    expect(result.output.target).toBe('node');
    expect(typeof result.tools?.bundlerChain).toBe('function');

    const targetCalls: any[] = [];
    const moduleCalls: any[] = [];
    const chunkFormatCalls: any[] = [];
    const chunkLoadingCalls: any[] = [];
    const libraryCalls: any[] = [];

    const chain = {
      target: (...args: any[]) => {
        targetCalls.push(args);
      },
      output: {
        module: (...args: any[]) => {
          moduleCalls.push(args);
        },
        chunkFormat: (...args: any[]) => {
          chunkFormatCalls.push(args);
        },
        chunkLoading: (...args: any[]) => {
          chunkLoadingCalls.push(args);
        },
        get: () => ({ name: 'test-app' }),
        library: (...args: any[]) => {
          libraryCalls.push(args);
        },
      },
    };

    result.tools.bundlerChain(chain);

    expect(targetCalls).toEqual([['async-node']]);
    expect(moduleCalls).toEqual([[false]]);
    expect(chunkFormatCalls).toEqual([['commonjs']]);
    expect(chunkLoadingCalls).toEqual([['async-node']]);
    expect(libraryCalls).toEqual([
      [
        {
          name: 'test-app',
          type: 'commonjs-module',
        },
      ],
    ]);
  });

  it('does not force module federation node output when SSR and SSG are disabled', () => {
    const transform = createEnvironmentConfigTransformer({
      normalizedConfig: {},
    });

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
  });
});

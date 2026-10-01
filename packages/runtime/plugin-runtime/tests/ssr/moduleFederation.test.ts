import ssrPlugin from '../../src/cli/ssr';

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

describe('RSC compile-time definition', () => {
  it.each([
    {
      expected: 'false',
      name: 'non-RSC',
      normalizedConfig: {},
    },
    {
      expected: 'true',
      name: 'RSC',
      normalizedConfig: { server: { rsc: true } },
    },
  ])('defines the native and compatibility flags for $name builds', entry => {
    const transform = createEnvironmentConfigTransformer({
      normalizedConfig: entry.normalizedConfig,
    });
    const result = transform(
      {
        output: {
          target: 'web',
        },
      },
      'client',
    );

    expect(result.source?.define).toMatchObject({
      __MODERN_ENABLE_RSC__: entry.expected,
      'process.env.MODERN_ENABLE_RSC': entry.expected,
    });
  });
});

describe('native SSR output defaults', () => {
  it.each([
    { outputModule: true, target: 'node', name: 'server', expected: true },
    { outputModule: false, target: 'node', name: 'server', expected: false },
    { outputModule: true, target: 'web', name: 'client', expected: false },
    {
      outputModule: false,
      target: 'web-worker',
      name: 'workerSSR',
      expected: false,
    },
  ])(
    'preserves $name output module=$outputModule',
    ({ outputModule, target, name, expected }) => {
      const transform = createEnvironmentConfigTransformer({ outputModule });
      const result = transform({ output: { target } }, name);
      expect(result.output).toMatchObject({ target, module: expected });
      expect(
        result.source.define['process.env.MODERN_MF_APP_SSR'],
      ).toBeUndefined();
      expect(result.splitChunks).toBeUndefined();
    },
  );
});

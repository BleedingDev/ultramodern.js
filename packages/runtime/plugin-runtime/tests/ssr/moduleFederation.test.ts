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

describe('module federation SSR output compatibility', () => {
  afterEach(() => {
    delete process.env.MF_SSR_PRJ;
    delete process.env.MODERN_MF_APP_SSR_REQUIRE_EXPLICIT;
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

  it('treats node-prefixed targets as server targets for module federation detection', () => {
    expect(
      shouldUseModuleFederationNodeOutput({
        output: { target: 'node18' },
        source: {
          define: {
            REMOTE_IP_STRATEGY: '"inherit"',
          },
        },
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
    expect(result.source?.define?.['process.env.MODERN_MF_APP_SSR']).toBe(
      'false',
    );
    expect(result.tools?.bundlerChain).toBeUndefined();
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
        'false',
      );
      expect(result.splitChunks).toBe(false);
      expect(result.tools?.bundlerChain).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0] || '')).toContain('mf-ssr');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps explicit module federation SSR server output in one chunk', () => {
    const transform = createEnvironmentConfigTransformer({
      normalizedConfig: {
        server: { ssr: { moduleFederationAppSSR: true } },
      },
    });
    const result = transform({ output: { target: 'node' } });

    expect(result.splitChunks).toBe(false);
  });

  it('does not force module federation node output for custom node targets from runtime markers alone', () => {
    const warnSpy = rs.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const transform = createEnvironmentConfigTransformer();
      const result = transform({
        output: {
          target: 'node18',
        },
        source: {
          define: {
            REMOTE_IP_STRATEGY: '"inherit"',
          },
        },
      });

      expect(result.output.module).toBe(true);
      expect(result.output.target).toBe('node18');
      expect(result.source?.define?.['process.env.MODERN_MF_APP_SSR']).toBe(
        'false',
      );
      expect(result.tools?.bundlerChain).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0] || '')).toContain('mf-ssr');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('warns when module federation SSR is auto-detected without explicit stable flag', () => {
    const warnSpy = rs.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const transform = createEnvironmentConfigTransformer({
        normalizedConfig: {
          server: {
            ssr: {
              mode: 'stream',
            },
          },
        },
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

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0] || '')).toContain('mf-ssr');
      expect(result.output.module).toBe(true);
      expect(result.output.target).toBe('node');
      expect(result.source?.define?.['process.env.MODERN_MF_APP_SSR']).toBe(
        'false',
      );
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
      'true',
    );
    expect(result.tools?.bundlerChain).toBeUndefined();
  });

  it('keeps esm node output when stable flag is set via ssrByEntries', () => {
    const transform = createEnvironmentConfigTransformer({
      normalizedConfig: {
        server: {
          ssrByEntries: {
            main: {
              mode: 'stream',
              moduleFederationAppSSR: true,
            },
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
      'true',
    );
    expect(result.tools?.bundlerChain).toBeUndefined();
  });

  it('honors explicit mf ssr stable flag for Cloudflare worker SSR builds', () => {
    const transform = createEnvironmentConfigTransformer({
      normalizedConfig: {
        deploy: {
          target: 'cloudflare',
        },
        server: {
          ssr: {
            mode: 'stream',
            moduleFederationAppSSR: true,
          },
        },
      },
    });

    const result = transform(
      {
        output: {
          target: 'web-worker',
        },
      },
      'workerSSR',
    );

    expect(result.output.module).toBe(true);
    expect(result.output.target).toBe('web-worker');
    expect(result.source?.define?.['process.env.MODERN_MF_APP_SSR']).toBe(
      'true',
    );
  });
});

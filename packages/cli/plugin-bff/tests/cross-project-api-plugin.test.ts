import {
  crossProjectApiPlugin,
  PREFIX,
  RUNTIME_FRAMEWORK,
} from '../src/utils/crossProjectApiPlugin';

function runWithConfig(
  config: Record<string, any>,
  initialResolvedConfig: Record<string, any> = {
    bff: {
      prefix: '/api',
      runtimeFramework: 'hono' as 'hono' | 'effect',
      isCrossProjectServer: false,
    },
  },
) {
  const plugin = crossProjectApiPlugin();
  const resolvedConfig = initialResolvedConfig;
  let nextAppContext: Record<string, unknown> = {};

  plugin.setup({
    getAppContext() {
      return {
        appDirectory: '/consumer-app',
      };
    },
    updateAppContext(partial) {
      nextAppContext = partial as Record<string, unknown>;
    },
    getConfig() {
      return config;
    },
    modifyResolvedConfig(modifier) {
      modifier(resolvedConfig as any);
    },
  } as any);

  return {
    resolvedConfig,
    nextAppContext,
  };
}

describe('crossProjectApiPlugin', () => {
  test('throws when consumer bff.prefix conflicts with producer prefix', () => {
    expect(() =>
      runWithConfig({
        bff: {
          prefix: '/custom-prefix',
        },
      }),
    ).toThrow(/Invalid bff\.prefix/);
  });

  test('throws when consumer runtime framework conflicts with producer', () => {
    const conflictRuntime = RUNTIME_FRAMEWORK === 'hono' ? 'effect' : 'hono';
    expect(() =>
      runWithConfig({
        bff: {
          runtimeFramework: conflictRuntime,
        },
      }),
    ).toThrow(/Runtime framework mismatch/);
  });

  test('accepts matching producer config and injects cross-project settings', () => {
    const { resolvedConfig, nextAppContext } = runWithConfig({
      bff: {
        prefix: PREFIX,
        runtimeFramework: RUNTIME_FRAMEWORK,
      },
    });

    expect(resolvedConfig.bff.prefix).toBe(PREFIX);
    expect(resolvedConfig.bff.runtimeFramework).toBe(RUNTIME_FRAMEWORK);
    expect(resolvedConfig.bff.isCrossProjectServer).toBe(true);
    expect(nextAppContext.bffRuntimeFramework).toBe(RUNTIME_FRAMEWORK);
  });

  test('initializes BFF config for consumers without a local BFF block', () => {
    const { resolvedConfig } = runWithConfig({}, {});

    expect(resolvedConfig.bff).toMatchObject({
      prefix: PREFIX,
      runtimeFramework: RUNTIME_FRAMEWORK,
      isCrossProjectServer: true,
      crossProjectPolicy: {
        enabled: true,
        requireEnvelope: true,
      },
    });
  });
});

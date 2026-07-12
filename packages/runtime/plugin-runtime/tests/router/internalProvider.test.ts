import { rstest } from '@rstest/core';
import type { RouterProviderFactory } from '../../src/router/runtime/provider';

/**
 * Loading the built-in router runtime plugin module must register
 * react-router as the default router provider (module-scope side effect).
 * Kept in its own test file so the registry state is untouched by other
 * suites.
 */
describe('built-in router provider registration', () => {
  it('registers react-router as the default provider on module load', async () => {
    // The react-router runtime plugin references webpack globals when its
    // module graph is evaluated outside a bundle.
    (
      globalThis as typeof globalThis & {
        __webpack_require__?: { u: (chunkId: unknown) => string };
      }
    ).__webpack_require__ = {
      u: chunkId => String(chunkId),
    };

    const { resolveRouterProvider } = await import(
      '../../src/router/runtime/internal'
    );
    const { routerPlugin: reactRouterPlugin } = await import(
      '../../src/router/runtime/plugin'
    );

    expect(resolveRouterProvider(undefined)).toBe(reactRouterPlugin);
    expect(resolveRouterProvider('react-router')).toBe(reactRouterPlugin);
  });

  it('binds each router wrapper to its own local provider factory', async () => {
    const { createRouterPlugin } = await import(
      '../../src/router/runtime/internal'
    );
    const setupA = rstest.fn();
    const setupB = rstest.fn();
    const factoryA = rstest.fn(() => ({
      setup: setupA,
    })) as RouterProviderFactory;
    const factoryB = rstest.fn(() => ({
      setup: setupB,
    })) as RouterProviderFactory;
    const wrapperA = createRouterPlugin([
      { name: 'tanstack', factory: factoryA },
    ]);
    const wrapperB = createRouterPlugin([
      { name: 'tanstack', factory: factoryB },
    ]);
    const apiA = {
      getRuntimeConfig: () => ({ router: { framework: 'tanstack' } }),
    };
    const apiB = {
      getRuntimeConfig: () => ({ router: { framework: 'tanstack' } }),
    };

    wrapperA().setup?.(apiA);
    wrapperB().setup?.(apiB);

    expect(factoryA).toHaveBeenCalledTimes(1);
    expect(factoryB).toHaveBeenCalledTimes(1);
    expect(setupA).toHaveBeenCalledWith(apiA);
    expect(setupB).toHaveBeenCalledWith(apiB);
  });

  it('does not invoke a compatibility provider missing from the wrapper realm', async () => {
    const { createRouterPlugin, registerRouterProvider } = await import(
      '../../src/router/runtime/internal'
    );
    const { unsafe_resetRouterProvidersForTesting } = await import(
      '../../src/router/runtime/provider'
    );
    const foreignFactory = rstest.fn(() => {
      throw new Error('foreign tanstack factory was invoked');
    }) as RouterProviderFactory;

    unsafe_resetRouterProvidersForTesting();
    try {
      registerRouterProvider('tanstack', foreignFactory);
      const wrapper = createRouterPlugin();
      const api = {
        getRuntimeConfig: () => ({ router: { framework: 'tanstack' } }),
      };

      expect(() => wrapper().setup?.(api)).toThrow(
        /not registered in the app-owned router provider realm/,
      );
      expect(foreignFactory).not.toHaveBeenCalled();
    } finally {
      unsafe_resetRouterProvidersForTesting();
    }
  });
});

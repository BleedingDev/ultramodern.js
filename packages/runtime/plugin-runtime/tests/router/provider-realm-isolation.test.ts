import { rstest } from '@rstest/core';
import type { RouterProviderFactory } from '../../src/router/runtime/provider';

const REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers:v2',
);

type ProviderRuntime = typeof import('../../src/router/runtime/provider');

const host = globalThis as { [REGISTRY_SLOT]?: unknown };

function createFactory(verticalName: string): RouterProviderFactory {
  return () => ({ name: verticalName }) as ReturnType<RouterProviderFactory>;
}

async function loadIndependentProviderRuntime(): Promise<ProviderRuntime> {
  // An MF-loaded vertical can evaluate its own bundled plugin/runtime copy.
  // Resetting Rstest's module registry creates that fresh module instance while
  // intentionally leaving globalThis (the browser realm) shared.
  rstest.resetModules();
  return import('../../src/router/runtime/provider');
}

describe('router provider registry realm isolation (MicroVertical reproduction)', () => {
  beforeEach(() => {
    delete host[REGISTRY_SLOT];
    rstest.resetModules();
  });

  afterEach(() => {
    delete host[REGISTRY_SLOT];
    rstest.resetModules();
  });

  it("makes the second vertical resolve the first vertical's same-name non-default factory", async () => {
    const verticalA = await loadIndependentProviderRuntime();
    const tanstackA = createFactory('vertical-a-tanstack');
    verticalA.registerRouterProvider('tanstack', tanstackA);

    const verticalB = await loadIndependentProviderRuntime();
    const tanstackB = createFactory('vertical-b-tanstack');

    // Proves separate evaluated runtime modules, analogous to two MF bundles.
    expect(verticalB).not.toBe(verticalA);

    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(() =>
        verticalB.registerRouterProvider('tanstack', tanstackB),
      ).not.toThrow();

      // SUSPECTED MODEL VIOLATION: the shared-realm registry keeps vertical A's
      // closure, so vertical B resolves A's provider rather than its own.
      expect(verticalB.resolveRouterProvider('tanstack')).toBe(tanstackA);
      expect(verticalB.resolveRouterProvider('tanstack')).not.toBe(tanstackB);
      // This is warned, but registration succeeds and B has no local fallback
      // for an explicitly configured non-default framework.
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('rejects a different non-default provider from a second vertical', async () => {
    const verticalA = await loadIndependentProviderRuntime();
    verticalA.registerRouterProvider('tanstack', createFactory('vertical-a'));

    const verticalB = await loadIndependentProviderRuntime();
    expect(verticalB).not.toBe(verticalA);

    // SUSPECTED MODEL VIOLATION: independent verticals cannot each select a
    // different non-default router while sharing one JavaScript realm.
    expect(() =>
      verticalB.registerRouterProvider('custom', createFactory('vertical-b')),
    ).toThrow(/competing router provider "tanstack"/);
  });

  it('does not let localDefault rescue a second vertical using a different non-default provider', async () => {
    const verticalA = await loadIndependentProviderRuntime();
    verticalA.registerRouterProvider('tanstack', createFactory('vertical-a'));

    const verticalB = await loadIndependentProviderRuntime();
    const localDefault = createFactory('vertical-b-react-router');

    // Match the existing localDefault escape: it returns B's own factory only
    // for the default path, not for B's configured non-default framework.
    expect(
      verticalB.resolveRouterProvider(undefined, {
        localDefault: { name: 'react-router', factory: localDefault },
      }),
    ).toBe(localDefault);

    // SUSPECTED MODEL VIOLATION: localDefault neither scopes the registry nor
    // permits B's custom router registration after A selected TanStack.
    expect(() =>
      verticalB.registerRouterProvider('custom', createFactory('vertical-b')),
    ).toThrow(/competing router provider "tanstack"/);
    expect(() =>
      verticalB.resolveRouterProvider('custom', {
        localDefault: { name: 'react-router', factory: localDefault },
      }),
    ).toThrow(/Unknown router framework "custom"/);
  });
});

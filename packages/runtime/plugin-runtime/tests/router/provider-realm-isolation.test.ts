import { rstest } from '@rstest/core';
import type { RouterProviderFactory } from '../../src/router/runtime/provider';

type ProviderRuntime = typeof import('../../src/router/runtime/provider');

const V2_REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers:v2',
);
const V3_REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers:v3',
);
type CompatibilityRegistry = {
  providers: Map<string, RouterProviderFactory>;
  defaultProvider?: string;
  duplicateProviders?: Set<string>;
  warnedDuplicates?: Set<string>;
};
type CompatibilityRegistrySlot =
  | typeof V2_REGISTRY_SLOT
  | typeof V3_REGISTRY_SLOT;

const host = globalThis as typeof globalThis & {
  [V2_REGISTRY_SLOT]?: CompatibilityRegistry;
  [V3_REGISTRY_SLOT]?: CompatibilityRegistry;
};
const COMPATIBILITY_REGISTRY_SLOTS = [
  ['v3', V3_REGISTRY_SLOT],
  ['v2', V2_REGISTRY_SLOT],
] as const;

function createFactory(owner: string): RouterProviderFactory {
  const factory = (() => {
    throw new Error(`factory for "${owner}" was invoked unexpectedly`);
  }) as RouterProviderFactory;
  (factory as unknown as { __owner: string }).__owner = owner;
  return factory;
}

function ownerOf(factory: RouterProviderFactory): string {
  return (factory as unknown as { __owner: string }).__owner;
}

function createForeignFactory(owner: string): RouterProviderFactory {
  return rstest.fn(() => {
    throw new Error(`foreign factory for "${owner}" was invoked`);
  }) as RouterProviderFactory;
}

function installCompatibilityProvider(
  slot: CompatibilityRegistrySlot,
  name: string,
  factory: RouterProviderFactory,
  options: { isDefault?: boolean } = {},
): void {
  host[slot] = {
    providers: new Map([[name, factory]]),
    ...(options.isDefault === true ? { defaultProvider: name } : {}),
  };
}

async function loadVerticalRuntime(): Promise<ProviderRuntime> {
  rstest.resetModules();
  return import('../../src/router/runtime/provider');
}

function createVerticalRealm(
  runtime: ProviderRuntime,
  reactRouter: RouterProviderFactory,
  provider: { name: string; factory: RouterProviderFactory },
) {
  return runtime.createRouterProviderRealm([
    { name: 'react-router', factory: reactRouter, isDefault: true },
    provider,
  ]);
}

describe('router provider runtime-realm isolation', () => {
  beforeEach(() => {
    delete host[V2_REGISTRY_SLOT];
    delete host[V3_REGISTRY_SLOT];
    rstest.resetModules();
  });

  afterEach(() => {
    delete host[V2_REGISTRY_SLOT];
    delete host[V3_REGISTRY_SLOT];
    rstest.resetModules();
  });

  it('resolves each independently evaluated vertical provider from its own realm', async () => {
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const verticalA = await loadVerticalRuntime();
      const reactRouterA = createFactory('A:react-router');
      const tanstackA = createFactory('A:tanstack');
      verticalA.registerRouterProvider('react-router', reactRouterA, {
        isDefault: true,
      });
      verticalA.registerRouterProvider('tanstack', tanstackA);
      const realmA = createVerticalRealm(verticalA, reactRouterA, {
        name: 'tanstack',
        factory: tanstackA,
      });

      const verticalB = await loadVerticalRuntime();
      const reactRouterB = createFactory('B:react-router');
      const tanstackB = createFactory('B:tanstack');
      verticalB.registerRouterProvider('react-router', reactRouterB, {
        isDefault: true,
      });
      verticalB.registerRouterProvider('tanstack', tanstackB);
      const realmB = createVerticalRealm(verticalB, reactRouterB, {
        name: 'tanstack',
        factory: tanstackB,
      });

      expect(
        ownerOf(verticalA.resolveRouterProvider('tanstack', { realm: realmA })),
      ).toBe('A:tanstack');
      expect(
        ownerOf(verticalB.resolveRouterProvider('tanstack', { realm: realmB })),
      ).toBe('B:tanstack');
      expect(
        verticalA.resolveRouterProvider(undefined, { realm: realmA }),
      ).toBe(reactRouterA);
      expect(
        verticalB.resolveRouterProvider(undefined, { realm: realmB }),
      ).toBe(reactRouterB);

      // The shared slot remains a legacy keep-first fallback. Production
      // wrappers pass their app realm and therefore never consume this answer.
      expect(verticalB.resolveRouterProvider('tanstack')).toBe(tanstackA);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/keeping the first registration/),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('allows independent realms to select different non-default providers', async () => {
    const verticalA = await loadVerticalRuntime();
    const tanstackA = createFactory('A:tanstack');
    verticalA.registerRouterProvider('tanstack', tanstackA);
    const realmA = createVerticalRealm(
      verticalA,
      createFactory('A:react-router'),
      { name: 'tanstack', factory: tanstackA },
    );

    const verticalB = await loadVerticalRuntime();
    const solidRouterB = createFactory('B:solid-router');
    expect(() =>
      verticalB.registerRouterProvider('solid-router', solidRouterB),
    ).not.toThrow();
    const realmB = createVerticalRealm(
      verticalB,
      createFactory('B:react-router'),
      { name: 'solid-router', factory: solidRouterB },
    );

    expect(verticalA.resolveRouterProvider('tanstack', { realm: realmA })).toBe(
      tanstackA,
    );
    expect(
      verticalB.resolveRouterProvider('solid-router', { realm: realmB }),
    ).toBe(solidRouterB);
  });

  it.each(
    COMPATIBILITY_REGISTRY_SLOTS,
  )('fails closed instead of invoking a foreign %s provider for an explicit framework', async (_version, slot) => {
    const foreignTanstack = createForeignFactory('foreign:tanstack');
    installCompatibilityProvider(slot, 'tanstack', foreignTanstack);

    const currentRuntime = await loadVerticalRuntime();
    const currentReactRouter = createFactory('current:react-router');
    const currentRealm = currentRuntime.createRouterProviderRealm([
      {
        name: 'react-router',
        factory: currentReactRouter,
        isDefault: true,
      },
    ]);

    expect(() =>
      currentRuntime.resolveRouterProvider('tanstack', {
        realm: currentRealm,
      })({}),
    ).toThrow(
      /not registered in the app-owned router provider realm.*fallback is disabled/s,
    );
    expect(foreignTanstack).not.toHaveBeenCalled();
    expect(
      currentRuntime.resolveRouterProvider(undefined, {
        realm: currentRealm,
      }),
    ).toBe(currentReactRouter);
  });

  it.each(
    COMPATIBILITY_REGISTRY_SLOTS,
  )('fails closed instead of invoking a foreign %s default provider', async (_version, slot) => {
    const foreignDefault = createForeignFactory('foreign:react-router');
    installCompatibilityProvider(slot, 'react-router', foreignDefault, {
      isDefault: true,
    });

    const currentRuntime = await loadVerticalRuntime();
    const currentTanstack = createFactory('current:tanstack');
    const currentRealm = currentRuntime.createRouterProviderRealm([
      { name: 'tanstack', factory: currentTanstack },
    ]);

    expect(() =>
      currentRuntime.resolveRouterProvider(undefined, {
        realm: currentRealm,
      })({}),
    ).toThrow(/does not declare a default provider/);
    expect(foreignDefault).not.toHaveBeenCalled();
    expect(
      currentRuntime.resolveRouterProvider('tanstack', {
        realm: currentRealm,
      }),
    ).toBe(currentTanstack);
  });
});

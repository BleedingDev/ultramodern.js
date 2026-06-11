import type { RuntimePlugin } from '../../src/core';
import type { RouterExtendsHooks } from '../../src/router/runtime/hooks';
import {
  type RouterProviderFactory,
  registerRouterProvider,
  resolveRouterProvider,
  unsafe_resetRouterProvidersForTesting,
} from '../../src/router/runtime/provider';

const createFactory = (name: string): RouterProviderFactory => {
  return () =>
    ({
      name,
      setup: () => undefined,
    }) as RuntimePlugin<{ extendHooks: RouterExtendsHooks }>;
};

describe('router provider registry', () => {
  beforeEach(() => {
    unsafe_resetRouterProvidersForTesting();
  });

  afterAll(() => {
    unsafe_resetRouterProvidersForTesting();
  });

  it('resolves the default provider when no framework is configured', () => {
    const reactRouter = createFactory('react-router-plugin');
    registerRouterProvider('react-router', reactRouter, { isDefault: true });

    expect(resolveRouterProvider(undefined)).toBe(reactRouter);
    expect(resolveRouterProvider('react-router')).toBe(reactRouter);
  });

  it('resolves a registered non-default provider by name', () => {
    registerRouterProvider('react-router', createFactory('react-router'), {
      isDefault: true,
    });
    const tanstack = createFactory('tanstack');
    registerRouterProvider('tanstack', tanstack);

    expect(resolveRouterProvider('tanstack')).toBe(tanstack);
    // The default stays intact.
    expect(resolveRouterProvider(undefined)).not.toBe(tanstack);
  });

  it('falls back to the default provider for falsy framework values', () => {
    const reactRouter = createFactory('react-router-plugin');
    registerRouterProvider('react-router', reactRouter, { isDefault: true });

    expect(resolveRouterProvider('' as never)).toBe(reactRouter);
    expect(resolveRouterProvider(false as never)).toBe(reactRouter);
    expect(resolveRouterProvider(undefined)).toBe(reactRouter);
  });

  it('tolerates idempotent re-registration of the same factory silently', () => {
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const tanstack = createFactory('tanstack');
      registerRouterProvider('tanstack', tanstack);
      expect(() => registerRouterProvider('tanstack', tanstack)).not.toThrow();
      expect(resolveRouterProvider('tanstack')).toBe(tanstack);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps the first registration and warns once when a duplicate module copy re-registers a name', () => {
    // Simulates a Module Federation remote that bundles its own copy of
    // '@modern-js/plugin-tanstack/runtime': the second copy evaluates the
    // registration side effect again with a fresh factory function.
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const hostCopy = createFactory('tanstack-host');
      const remoteCopy = createFactory('tanstack-remote');

      registerRouterProvider('tanstack', hostCopy);
      expect(() =>
        registerRouterProvider('tanstack', remoteCopy),
      ).not.toThrow();

      // First registration wins.
      expect(resolveRouterProvider('tanstack')).toBe(hostCopy);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/keeping the first registration/),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/@modern-js\/plugin-tanstack\/runtime/),
      );

      // A third evaluation does not warn again for the same name.
      registerRouterProvider('tanstack', createFactory('tanstack-third'));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(resolveRouterProvider('tanstack')).toBe(hostCopy);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps the default provider intact when a duplicate default copy registers', () => {
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = createFactory('react-router-first');
      const second = createFactory('react-router-second');

      registerRouterProvider('react-router', first, { isDefault: true });
      registerRouterProvider('react-router', second, { isDefault: true });

      expect(resolveRouterProvider(undefined)).toBe(first);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('throws loudly when two competing non-default providers are registered', () => {
    registerRouterProvider('tanstack', createFactory('tanstack'));
    expect(() =>
      registerRouterProvider('solid-router', createFactory('solid-router')),
    ).toThrow(/competing router provider "tanstack"/);
  });

  it('points users at @modern-js/plugin-tanstack for an unregistered tanstack framework', () => {
    registerRouterProvider('react-router', createFactory('react-router'), {
      isDefault: true,
    });

    expect(() => resolveRouterProvider('tanstack')).toThrow(
      /@modern-js\/plugin-tanstack/,
    );
  });

  it('lists registered providers for an unknown framework value', () => {
    registerRouterProvider('react-router', createFactory('react-router'), {
      isDefault: true,
    });

    expect(() => resolveRouterProvider('not-a-router')).toThrow(
      /Unknown router framework "not-a-router".*react-router/s,
    );
  });

  describe('mixed-version registry isolation (Module Federation)', () => {
    // Old published copies of @modern-js/runtime own the unversioned key and
    // THROW on duplicate-name registration; the current module must use the
    // ':v2' key so the two generations never share a registry object.
    const OLD_REGISTRY_SLOT: unique symbol = Symbol.for(
      '@modern-js/runtime:router-providers',
    );
    const V2_REGISTRY_SLOT: unique symbol = Symbol.for(
      '@modern-js/runtime:router-providers:v2',
    );

    /** Registry shape written by old published copies (no warnedDuplicates). */
    type OldRegistryShape = {
      providers: Map<string, RouterProviderFactory>;
      defaultProvider?: string;
      nonDefaultProvider?: string;
    };

    type V2RegistryShape = OldRegistryShape & {
      warnedDuplicates?: Set<string>;
    };

    const host = globalThis as {
      [OLD_REGISTRY_SLOT]?: OldRegistryShape;
      [V2_REGISTRY_SLOT]?: V2RegistryShape;
    };

    afterEach(() => {
      delete host[OLD_REGISTRY_SLOT];
      unsafe_resetRouterProvidersForTesting();
    });

    it('never joins a registry created by an old runtime copy under the unversioned key', () => {
      // An OLD copy already created its registry under the unversioned key
      // and registered "tanstack" (e.g. an MF remote bundling a published
      // @modern-js/runtime that predates keep-first semantics).
      const oldCopyFactory = createFactory('tanstack-old-runtime-copy');
      host[OLD_REGISTRY_SLOT] = {
        providers: new Map([['tanstack', oldCopyFactory]]),
        nonDefaultProvider: 'tanstack',
      };
      const warnSpy = rstest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      try {
        const newCopyFactory = createFactory('tanstack-new-runtime-copy');
        // The new copy must not throw even though "tanstack" is taken by a
        // different factory in the old registry...
        expect(() =>
          registerRouterProvider('tanstack', newCopyFactory),
        ).not.toThrow();
        // ...because it registers into its own v2 registry and resolves
        // itself there.
        expect(resolveRouterProvider('tanstack')).toBe(newCopyFactory);
        expect(host[V2_REGISTRY_SLOT]?.providers.get('tanstack')).toBe(
          newCopyFactory,
        );
        // Fresh registration in an empty v2 registry, not a dedup: no warn.
        expect(warnSpy).not.toHaveBeenCalled();
        // The old copy's registry is untouched, so the old copy's throwing
        // duplicate check never observes the new copy's registration either.
        expect(host[OLD_REGISTRY_SLOT]?.providers.get('tanstack')).toBe(
          oldCopyFactory,
        );
        expect(host[OLD_REGISTRY_SLOT]?.providers.size).toBe(1);
        expect(host[OLD_REGISTRY_SLOT]).not.toHaveProperty('warnedDuplicates');
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('heals a v2-keyed registry that lacks later-added fields', () => {
      // A v2-keyed copy from an earlier minor could have created the registry
      // without `warnedDuplicates`; the current copy must heal the shape
      // instead of crashing in the duplicate-warning path.
      const existing = createFactory('tanstack-existing');
      host[V2_REGISTRY_SLOT] = {
        providers: new Map([['tanstack', existing]]),
      };
      const warnSpy = rstest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      try {
        expect(() =>
          registerRouterProvider('tanstack', createFactory('tanstack-dup')),
        ).not.toThrow();
        // Keep-first semantics still hold against the pre-seeded registry.
        expect(resolveRouterProvider('tanstack')).toBe(existing);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(host[V2_REGISTRY_SLOT]?.warnedDuplicates?.has('tanstack')).toBe(
          true,
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

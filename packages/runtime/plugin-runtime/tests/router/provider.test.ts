import { createSyncHook } from '@modern-js/plugin';
import type { RuntimePlugin } from '../../src/core';
import * as contextSeam from '../../src/core/context';
import type { RouterExtendsHooks } from '../../src/router/runtime/hooks';
import * as routerHooks from '../../src/router/runtime/hooks';
import {
  createRouterProviderRealm,
  type RouterProviderFactory,
  registerRouterProvider,
  reportUnsupportedProviderRegistryHooks,
  resolveRouterProvider,
  routerProviderRegistryHooks,
  unsafe_resetRouterProvidersForTesting,
} from '../../src/router/runtime/provider';

const createFactory = (name: string): RouterProviderFactory => {
  return () =>
    ({
      name,
      setup: () => undefined,
    }) as RuntimePlugin<{ extendHooks: RouterExtendsHooks }>;
};

describe('router provider registry hooks (single declaration source)', () => {
  it('exposes exactly the six router hooks with the canonical instances', () => {
    expect(routerProviderRegistryHooks).toEqual({
      modifyRoutes: routerHooks.modifyRoutes,
      onAfterCreateRouter: routerHooks.onAfterCreateRouter,
      onAfterHydrateRouter: routerHooks.onAfterHydrateRouter,
      onBeforeCreateRouter: routerHooks.onBeforeCreateRouter,
      onBeforeCreateRoutes: routerHooks.onBeforeCreateRoutes,
      onBeforeHydrateRouter: routerHooks.onBeforeHydrateRouter,
    });
    expect(Object.keys(routerProviderRegistryHooks)).toHaveLength(6);
  });

  it("is re-exported through the '@modern-js/runtime/context' seam", () => {
    expect(contextSeam.routerProviderRegistryHooks).toBe(
      routerProviderRegistryHooks,
    );
  });
});

describe('reportUnsupportedProviderRegistryHooks', () => {
  it('warns about provider hooks outside the router hook contract instead of dropping them silently', () => {
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const unsupported = reportUnsupportedProviderRegistryHooks({
        name: 'hooky-provider',
        registryHooks: {
          ...routerProviderRegistryHooks,
          onSeventhHook: createSyncHook<() => void>(),
        },
      });

      expect(unsupported).toEqual(['onSeventhHook']);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/hooky-provider.*onSeventhHook/s),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('stays silent for providers using exactly the canonical hook set', () => {
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(
        reportUnsupportedProviderRegistryHooks({
          name: 'canonical-provider',
          registryHooks: routerProviderRegistryHooks,
        }),
      ).toEqual([]);
      expect(
        reportUnsupportedProviderRegistryHooks({ name: 'hookless-provider' }),
      ).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

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

  it('keeps the first registration and warns only when a duplicate compatibility fallback is consumed', () => {
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
      expect(warnSpy).not.toHaveBeenCalled();

      // First registration wins for compatibility-only callers, which are
      // warned because they did not supply an app-owned provider realm.
      expect(resolveRouterProvider('tanstack')).toBe(hostCopy);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/keeping the first registration/),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/without an app-owned provider realm/),
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

  it("resolves the resolving module's own default-provider copy, not the first-registered foreign copy", () => {
    // Simulates an app-level Module Federation page: the host's runtime copy
    // registers 'react-router' first; the remote's copy is kept out by
    // keep-first semantics. The remote must still render with ITS OWN
    // react-router plugin (whose closures read the remote's global context),
    // not the host's copy — otherwise the bridged remote renders the host's
    // routes.
    const hostCopy = createFactory('react-router-host');
    const remoteCopy = createFactory('react-router-remote');

    registerRouterProvider('react-router', hostCopy, { isDefault: true });
    registerRouterProvider('react-router', remoteCopy, { isDefault: true });

    const localDefault = { name: 'react-router', factory: remoteCopy };
    expect(resolveRouterProvider(undefined, { localDefault })).toBe(remoteCopy);
    expect(resolveRouterProvider('react-router', { localDefault })).toBe(
      remoteCopy,
    );
    // Without a local default the registry's keep-first answer still applies.
    expect(resolveRouterProvider(undefined)).toBe(hostCopy);
  });

  it("resolves resolving module's default provider when a foreign default provider registered first", () => {
    // Simulates an app-level Module Federation page where the host runtime
    // registered a different default provider before the remote app resolves
    // its own default router.
    const foreignDefault = createFactory('foreign-default');
    const localDefault = createFactory('react-router-local');

    registerRouterProvider('foreign-router', foreignDefault, {
      isDefault: true,
    });

    expect(
      resolveRouterProvider(undefined, {
        localDefault: { name: 'react-router', factory: localDefault },
      }),
    ).toBe(localDefault);
    // Without a local default, the registry default is still observable.
    expect(resolveRouterProvider(undefined)).toBe(foreignDefault);
  });

  it('ignores the local default when a non-default framework is configured', () => {
    const reactRouter = createFactory('react-router');
    const tanstack = createFactory('tanstack');
    registerRouterProvider('react-router', reactRouter, { isDefault: true });
    registerRouterProvider('tanstack', tanstack);

    expect(
      resolveRouterProvider('tanstack', {
        localDefault: { name: 'react-router', factory: reactRouter },
      }),
    ).toBe(tanstack);
  });

  it('resolves app-owned realm providers before compatibility registrations', () => {
    const hostTanstack = createFactory('host-tanstack');
    const localReactRouter = createFactory('local-react-router');
    const localTanstack = createFactory('local-tanstack');
    registerRouterProvider('tanstack', hostTanstack);

    const realm = createRouterProviderRealm([
      {
        name: 'react-router',
        factory: localReactRouter,
        isDefault: true,
      },
      { name: 'tanstack', factory: localTanstack },
    ]);

    expect(resolveRouterProvider(undefined, { realm })).toBe(localReactRouter);
    expect(resolveRouterProvider('tanstack', { realm })).toBe(localTanstack);
    expect(resolveRouterProvider('tanstack')).toBe(hostTanstack);
    expect(realm.names()).toEqual(['react-router', 'tanstack']);
  });

  it('does not use the legacy local default for a provider missing from an app-owned realm', () => {
    const legacyLocalDefault = rstest.fn(() => ({
      name: 'legacy-local-default',
    })) as RouterProviderFactory;
    const realm = createRouterProviderRealm([
      {
        name: 'tanstack',
        factory: createFactory('local-tanstack'),
        isDefault: true,
      },
    ]);

    expect(() =>
      resolveRouterProvider('react-router', {
        realm,
        localDefault: {
          name: 'react-router',
          factory: legacyLocalDefault,
        },
      })({}),
    ).toThrow(/not registered in the app-owned router provider realm/);
    expect(legacyLocalDefault).not.toHaveBeenCalled();
  });

  it('rejects ambiguous provider declarations inside one runtime realm', () => {
    const tanstack = createFactory('tanstack');
    expect(() =>
      createRouterProviderRealm([
        { name: 'tanstack', factory: tanstack },
        { name: 'tanstack', factory: tanstack },
      ]),
    ).toThrow(/declared more than once/);

    expect(() =>
      createRouterProviderRealm([
        {
          name: 'react-router',
          factory: createFactory('react-router'),
          isDefault: true,
        },
        {
          name: 'tanstack',
          factory: tanstack,
          isDefault: true,
        },
      ]),
    ).toThrow(/declares both .* as defaults/);
  });

  it('falls back to the local default when nothing is registered yet', () => {
    const reactRouter = createFactory('react-router');

    expect(
      resolveRouterProvider(undefined, {
        localDefault: { name: 'react-router', factory: reactRouter },
      }),
    ).toBe(reactRouter);
  });

  it('keeps distinct compatibility providers addressable by explicit name', () => {
    const tanstack = createFactory('tanstack');
    const solidRouter = createFactory('solid-router');
    registerRouterProvider('tanstack', tanstack);
    expect(() =>
      registerRouterProvider('solid-router', solidRouter),
    ).not.toThrow();
    expect(resolveRouterProvider('tanstack')).toBe(tanstack);
    expect(resolveRouterProvider('solid-router')).toBe(solidRouter);
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
    // versioned key so incompatible generations never share a registry object.
    const OLD_REGISTRY_SLOT: unique symbol = Symbol.for(
      '@modern-js/runtime:router-providers',
    );
    const V2_REGISTRY_SLOT: unique symbol = Symbol.for(
      '@modern-js/runtime:router-providers:v2',
    );
    const V3_REGISTRY_SLOT: unique symbol = Symbol.for(
      '@modern-js/runtime:router-providers:v3',
    );

    /** Registry shape written by old published copies (no warnedDuplicates). */
    type OldRegistryShape = {
      providers: Map<string, RouterProviderFactory>;
      defaultProvider?: string;
      nonDefaultProvider?: string;
    };

    type V3RegistryShape = OldRegistryShape & {
      warnedDuplicates?: Set<string>;
    };

    const host = globalThis as {
      [OLD_REGISTRY_SLOT]?: OldRegistryShape;
      [V2_REGISTRY_SLOT]?: V3RegistryShape;
      [V3_REGISTRY_SLOT]?: V3RegistryShape;
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
        // ...because it registers into its own v3 registry and resolves
        // itself there.
        expect(resolveRouterProvider('tanstack')).toBe(newCopyFactory);
        expect(host[V3_REGISTRY_SLOT]?.providers.get('tanstack')).toBe(
          newCopyFactory,
        );
        // Fresh registration in an empty v3 registry, not a dedup: no warn.
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

    it('reads a v2 compatibility registry without mutating it', () => {
      const v2Factory = createFactory('tanstack-v2-runtime-copy');
      host[V2_REGISTRY_SLOT] = {
        providers: new Map([['tanstack', v2Factory]]),
        nonDefaultProvider: 'tanstack',
        warnedDuplicates: new Set(),
      };

      expect(resolveRouterProvider('tanstack')).toBe(v2Factory);

      const v3Factory = createFactory('tanstack-v3-runtime-copy');
      registerRouterProvider('tanstack', v3Factory);
      expect(resolveRouterProvider('tanstack')).toBe(v3Factory);

      const realmFactory = createFactory('tanstack-app-realm');
      const realm = createRouterProviderRealm([
        { name: 'tanstack', factory: realmFactory },
      ]);
      expect(resolveRouterProvider('tanstack', { realm })).toBe(realmFactory);
      expect(host[V2_REGISTRY_SLOT]?.providers.get('tanstack')).toBe(v2Factory);
      expect(host[V2_REGISTRY_SLOT]?.warnedDuplicates).toEqual(new Set());
    });

    it('heals a v3-keyed registry that lacks later-added fields', () => {
      // A v3-keyed copy from an earlier minor could have created the registry
      // without `warnedDuplicates`; the current copy must heal the shape
      // instead of crashing in the duplicate-warning path.
      const existing = createFactory('tanstack-existing');
      host[V3_REGISTRY_SLOT] = {
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
        expect(host[V3_REGISTRY_SLOT]?.warnedDuplicates?.has('tanstack')).toBe(
          true,
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

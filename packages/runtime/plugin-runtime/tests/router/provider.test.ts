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
});

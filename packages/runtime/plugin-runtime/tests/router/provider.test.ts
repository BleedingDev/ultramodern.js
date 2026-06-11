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

  it('tolerates idempotent re-registration of the same factory', () => {
    const tanstack = createFactory('tanstack');
    registerRouterProvider('tanstack', tanstack);
    expect(() => registerRouterProvider('tanstack', tanstack)).not.toThrow();
  });

  it('throws loudly when one name is registered with two implementations', () => {
    registerRouterProvider('tanstack', createFactory('tanstack-a'));
    expect(() =>
      registerRouterProvider('tanstack', createFactory('tanstack-b')),
    ).toThrow(/already registered with a different implementation/);
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

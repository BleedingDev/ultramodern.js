import {
  modifyRoutes as canonicalModifyRoutes,
  routerProviderRegistryHooks,
} from '@modern-js/runtime/context';
import * as tanstackHooks from '../../src/runtime/hooks';
import { applyRouterRuntimeState } from '../../src/runtime/lifecycle';
import { tanstackRouterPlugin as browserPlugin } from '../../src/runtime/plugin';
import { tanstackRouterPlugin as nodePlugin } from '../../src/runtime/plugin.node';
import { getTanstackRouterState } from '../../src/runtime/state';

describe('tanstack router hooks single declaration source', () => {
  test('re-exports the canonical hook instances owned by @modern-js/runtime', () => {
    // Identity matters: separate instances would split the hook registry
    // between the built-in router wrapper and this provider.
    expect(tanstackHooks.modifyRoutes).toBe(canonicalModifyRoutes);
    expect(tanstackHooks.routerProviderRegistryHooks).toBe(
      routerProviderRegistryHooks,
    );
    expect(tanstackHooks.modifyRoutes).toBe(
      routerProviderRegistryHooks.modifyRoutes,
    );
  });

  test('both runtime plugins register the canonical hook registry object', () => {
    expect(browserPlugin().registryHooks).toBe(routerProviderRegistryHooks);
    expect(nodePlugin().registryHooks).toBe(routerProviderRegistryHooks);
  });
});

describe('tanstack router runtime state accessor', () => {
  test('returns undefined before a tanstack router instance is created', () => {
    const context = {};

    applyRouterRuntimeState(context as never, {
      framework: 'tanstack',
    });

    expect(getTanstackRouterState(context)).toBeUndefined();
  });
});

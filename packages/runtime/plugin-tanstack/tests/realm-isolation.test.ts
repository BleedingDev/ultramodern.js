import type {
  RouterProviderFactory,
  RouterProviderPlugin,
} from '@modern-js/runtime/context';
import { rstest } from '@rstest/core';
import type { RouterExtendsHooks } from '../src/runtime/hooks';

/**
 * MicroVertical W6 reproduction — REAL, independently-evaluated TanStack
 * provider instances.
 *
 * Unlike the sibling reproduction in @modern-js/plugin-runtime
 * (tests/router/provider-realm-isolation.test.ts), which hand-mints stub
 * factories against the real registry, this test lives in the package where
 * the REAL provider graph is installed (@tanstack/react-router,
 * @modern-js/runtime). It therefore drives the actual
 * `src/runtime/register.ts` side effect
 * (`registerRouterProvider('tanstack', tanstackRouterProviderFactory)`) twice,
 * once per simulated Module-Federation vertical, each time from a FRESH module
 * graph. The two loads produce genuinely distinct real factory functions and
 * distinct copies of the TanStack runtime module graph, while the provider
 * registry — keyed on `globalThis`
 * (`Symbol.for('@modern-js/runtime:router-providers:v2')`) — persists across
 * both loads (one shared realm).
 *
 * The observable wrong-router consequence is proven at the plugin level, not
 * just registry-identity: vertical B resolves 'tanstack', invokes the resolved
 * real factory, and the router-provider plugin it gets back is constructed by
 * vertical A's module copy — its `registryHooks` object is A's module-instance
 * hook set, never B's. In production those hooks (and every closure the plugin
 * builds its router from) are bound to app A's global routes/context, so app B
 * renders app A's router.
 *
 * No src/ file is modified. Registration + resolution run through the real,
 * unmodified module APIs. Assertions codify CURRENT behavior.
 */

const REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers:v2',
);

const host = globalThis as { [REGISTRY_SLOT]?: unknown };

type RuntimeContextModule = typeof import('@modern-js/runtime/context');
type HooksModule = typeof import('../src/runtime/hooks');

/**
 * One MF vertical evaluation: reset the module registry so the next imports
 * re-evaluate the entire TanStack provider graph (fresh module instance ⇒
 * fresh real factory + fresh hook set), then run the REAL side-effectful
 * registration module exactly as `import '@modern-js/plugin-tanstack/runtime'`
 * would. The `globalThis` provider registry deliberately survives across
 * verticals (shared realm). Returns handles into THIS vertical's module graph.
 */
async function loadVertical(): Promise<{
  context: RuntimeContextModule;
  hooks: RouterExtendsHooks;
}> {
  rstest.resetModules();
  // Real registration side effect: register.ts:26 registers a fresh
  // `tanstackRouterProviderFactory` for this module instance.
  await import('../src/runtime/register');
  // Same generation ⇒ same module instance the stored factory closes over.
  const context = (await import(
    '@modern-js/runtime/context'
  )) as RuntimeContextModule;
  const hooksModule = (await import('../src/runtime/hooks')) as HooksModule;
  return { context, hooks: hooksModule.routerProviderRegistryHooks };
}

describe('tanstack provider registry realm isolation (real plugin instances)', () => {
  beforeEach(() => {
    delete host[REGISTRY_SLOT];
    rstest.resetModules();
  });

  afterEach(() => {
    delete host[REGISTRY_SLOT];
    rstest.resetModules();
  });

  it("(a) vertical B resolves and invokes vertical A's real tanstack provider (wrong-router consequence)", async () => {
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // --- Vertical A: its own real @modern-js/plugin-tanstack/runtime copy. ---
      const verticalA = await loadVertical();
      const factoryA: RouterProviderFactory =
        verticalA.context.resolveRouterProvider('tanstack');
      expect(typeof factoryA).toBe('function');
      // Baseline: A invoking its own factory yields a plugin whose registry
      // hook set is A's module instance.
      const pluginA = factoryA({}) as RouterProviderPlugin & {
        registryHooks?: RouterExtendsHooks;
      };
      expect(pluginA.registryHooks).toBe(verticalA.hooks);

      // --- Vertical B: an INDEPENDENT real copy, one shared realm. ---
      const verticalB = await loadVertical();

      // Genuinely distinct real module instances (two MF bundles).
      expect(verticalB.context).not.toBe(verticalA.context);
      expect(verticalB.hooks).not.toBe(verticalA.hooks);

      // B resolves 'tanstack' through its OWN real runtime copy.
      const resolvedForB: RouterProviderFactory =
        verticalB.context.resolveRouterProvider('tanstack');

      // MODEL VIOLATION (identity): keep-first realm-global registry returns
      // A's exact factory function to B.
      expect(resolvedForB).toBe(factoryA);

      // MODEL VIOLATION (router-construction, not just registry identity):
      // invoking the factory B resolved builds a real provider plugin from
      // A's module copy — its registryHooks are A's instance, never B's. The
      // router B would mount is constructed by A's module graph.
      const pluginForB = resolvedForB({}) as RouterProviderPlugin & {
        registryHooks?: RouterExtendsHooks;
      };
      expect(pluginForB.registryHooks).toBe(verticalA.hooks);
      expect(pluginForB.registryHooks).not.toBe(verticalB.hooks);

      // B's own register.ts side effect warned (keep-first) but there is no
      // isolation escape hatch on the non-default provider path.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/keeping the first registration/),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('(b) a second vertical registering a different non-default provider throws through the real registration path', async () => {
    // Vertical A: real tanstack registration (non-default provider).
    const verticalA = await loadVertical();
    expect(typeof verticalA.context.resolveRouterProvider('tanstack')).toBe(
      'function',
    );

    // Vertical B: independent real runtime copy.
    const verticalB = await loadVertical();
    expect(verticalB.context).not.toBe(verticalA.context);

    // B registers a DIFFERENT non-default provider name through the REAL
    // registerRouterProvider path. The realm-global single-non-default-provider
    // invariant — an app-scoped rule — leaks across the two supposedly-isolated
    // apps and throws at registration time.
    const solidFactoryB: RouterProviderFactory = (() => {
      throw new Error('solid factory body unreached — registration throws');
    }) as unknown as RouterProviderFactory;

    expect(() =>
      verticalB.context.registerRouterProvider('solid-router', solidFactoryB),
    ).toThrow(/competing router provider "tanstack"/);
  });
});

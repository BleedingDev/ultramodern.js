import { rstest } from '@rstest/core';
import type { RouterProviderFactory } from '../../src/router/runtime/provider';

/**
 * MV-G31 reproduction — app-level Module Federation router-provider isolation.
 *
 * Scenario under test: a single page hosts two *independent* vertical bundles
 * (app-level MF remotes). Each vertical bundles its own copy of the
 * @modern-js/runtime router runtime and, optionally, its own copy of a router
 * provider plugin (e.g. @modern-js/plugin-tanstack). The two copies have
 * SEPARATE module caches but SHARE ONE realm: the provider registry lives on
 * `globalThis` under `Symbol.for('@modern-js/runtime:router-providers:v2')`
 * (see src/router/runtime/provider.ts `REGISTRY_SLOT`), so it persists across
 * both loads. Only the module instances — and therefore the factory *function
 * identities* they mint — differ.
 *
 * IMPORT CONSTRAINT (documented, not hand-waved):
 *   `@modern-js/plugin-tanstack` is NOT resolvable from this package's test
 *   env — it is not a dependency of @modern-js/runtime and
 *   `require.resolve('@modern-js/plugin-tanstack/runtime')` throws
 *   MODULE_NOT_FOUND. Importing its real registration module by relative path
 *   is also not viable here: `src/runtime/register.ts` imports `./plugin`,
 *   which transitively pulls the entire TanStack runtime graph
 *   (`@tanstack/react-router`, the RSC adapters, react, runtime-utils, ...),
 *   none of which is installed for this package. That whole graph is
 *   irrelevant to MV-G31, which is purely about *registry identity*.
 *
 *   So we reproduce the EXACT side effect of the real registration module
 *   against the REAL registry-under-test, rather than a hand-rolled registry:
 *     - registration is byte-identical to plugin-tanstack
 *       `src/runtime/register.ts:26`:
 *         `registerRouterProvider('tanstack', tanstackRouterProviderFactory)`
 *       where the factory is a fresh function per module evaluation. Each
 *       simulated vertical loads a FRESH copy of the real provider module
 *       (via `rstest.resetModules()` + dynamic import), so the registry it
 *       writes to is the real one and the factory identity is genuinely
 *       per-module-instance — exactly what two MF-bundled register.ts
 *       evaluations produce.
 *     - resolution is byte-identical to the built-in router wrapper
 *       `src/router/runtime/internal.ts:36-38`:
 *         `resolveRouterProvider(framework, {
 *            localDefault: { name: 'react-router', factory: reactRouterPlugin } })`
 *
 *   The factory *bodies* are never invoked (the wrapper resolves the factory
 *   by identity, then calls it). The bug is that the WRONG identity is
 *   resolved, so a stub body is faithful: it is precisely what `register.ts`
 *   registers — a thin closure minted once per module load.
 */

type ProviderRuntime = typeof import('../../src/router/runtime/provider');

const REGISTRY_SLOT: unique symbol = Symbol.for(
  '@modern-js/runtime:router-providers:v2',
);

const host = globalThis as { [REGISTRY_SLOT]?: unknown };

/**
 * A provider factory minted for one module load. Tagged with its owning
 * vertical so identity mismatches are legible in assertions/output. This is
 * the moral equivalent of `tanstackRouterProviderFactory` in register.ts: a
 * fresh function per evaluation whose body is never reached in this repro.
 */
function createFactory(owner: string): RouterProviderFactory {
  const factory = (() => {
    throw new Error(
      `factory for "${owner}" was invoked — this repro asserts on identity only`,
    );
  }) as RouterProviderFactory;
  (factory as unknown as { __owner: string }).__owner = owner;
  return factory;
}

function ownerOf(factory: RouterProviderFactory): string {
  return (factory as unknown as { __owner: string }).__owner;
}

/**
 * Simulate one MF vertical evaluating its OWN bundled copy of the router
 * runtime: reset the module registry so the next import re-evaluates the
 * provider module (fresh module instance ⇒ fresh factories), while the
 * `globalThis` registry deliberately survives (shared realm).
 */
async function loadVerticalRuntime(): Promise<ProviderRuntime> {
  rstest.resetModules();
  return import('../../src/router/runtime/provider');
}

/**
 * Mirror of the built-in router wrapper (`internal.ts` routerPlugin.setup):
 * a vertical always resolves through its OWN module instance, passing ITS OWN
 * react-router copy as the local default. Note the localDefault name is
 * hardcoded to 'react-router' in the real wrapper — a vertical configured for
 * a non-default framework (tanstack/solid) therefore gets NO local-default
 * rescue.
 */
function resolveThroughRouterWrapper(
  runtime: ProviderRuntime,
  framework: string | undefined,
  localReactRouter: RouterProviderFactory,
): RouterProviderFactory {
  return runtime.resolveRouterProvider(framework as never, {
    localDefault: { name: 'react-router', factory: localReactRouter },
  });
}

describe('router provider registry realm isolation (app-level MF reproduction)', () => {
  beforeEach(() => {
    delete host[REGISTRY_SLOT];
    rstest.resetModules();
  });

  afterEach(() => {
    delete host[REGISTRY_SLOT];
    rstest.resetModules();
  });

  it("(a) silently captures vertical B onto vertical A's tanstack factory (wrong-router routing consequence)", async () => {
    const warnSpy = rstest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // --- Vertical A: own runtime copy + own plugin-tanstack copy. ---
      const verticalA = await loadVerticalRuntime();
      const reactRouterA = createFactory('A:react-router');
      const tanstackA = createFactory('A:tanstack');
      // Built-in router plugin of A registers its react-router default.
      verticalA.registerRouterProvider('react-router', reactRouterA, {
        isDefault: true,
      });
      // A's `@modern-js/plugin-tanstack/runtime` import side effect (register.ts:26).
      verticalA.registerRouterProvider('tanstack', tanstackA);

      // A's wrapper resolves framework 'tanstack' → its own factory. Baseline.
      const resolvedForA = resolveThroughRouterWrapper(
        verticalA,
        'tanstack',
        reactRouterA,
      );
      expect(resolvedForA).toBe(tanstackA);

      // --- Vertical B: independent runtime copy + independent tanstack copy. ---
      const verticalB = await loadVerticalRuntime();
      // Genuinely distinct module instances (two MF bundles), one shared realm.
      expect(verticalB).not.toBe(verticalA);

      const reactRouterB = createFactory('B:react-router');
      const tanstackB = createFactory('B:tanstack');
      // Fresh module load ⇒ genuinely different factory identities than A.
      expect(tanstackB).not.toBe(tanstackA);
      expect(reactRouterB).not.toBe(reactRouterA);

      verticalB.registerRouterProvider('react-router', reactRouterB, {
        isDefault: true,
      });
      // B's own register.ts side effect: keep-first ⇒ does NOT throw, warns once.
      expect(() =>
        verticalB.registerRouterProvider('tanstack', tanstackB),
      ).not.toThrow();

      // B's wrapper resolves framework 'tanstack' with ITS OWN react-router
      // local default — exactly as internal.ts does.
      const resolvedForB = resolveThroughRouterWrapper(
        verticalB,
        'tanstack',
        reactRouterB,
      );

      // MODEL VIOLATION (routing-visible): B is silently captured onto A's
      // tanstack factory. `localDefault` names 'react-router', not 'tanstack',
      // so the escape hatch is bypassed and the realm-global keep-first winner
      // (A) is returned. App B builds its router from app A's module instance.
      expect(ownerOf(resolvedForB)).toBe('A:tanstack');
      expect(resolvedForB).toBe(tanstackA);
      expect(resolvedForB).not.toBe(tanstackB);

      // The runtime does surface a warning — but only a diagnostic; there is
      // no non-default escape hatch that would actually isolate the verticals.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/keeping the first registration/),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('(b) throws at load when a second vertical registers a different non-default provider', async () => {
    // Vertical A: tanstack. Vertical B: a different non-default router (solid).
    const verticalA = await loadVerticalRuntime();
    verticalA.registerRouterProvider('react-router', createFactory('A:rr'), {
      isDefault: true,
    });
    verticalA.registerRouterProvider('tanstack', createFactory('A:tanstack'));

    const verticalB = await loadVerticalRuntime();
    expect(verticalB).not.toBe(verticalA);
    verticalB.registerRouterProvider('react-router', createFactory('B:rr'), {
      isDefault: true,
    });

    // B's provider register.ts side effect runs at IMPORT time and crashes the
    // whole page: the realm-global single-non-default-provider invariant is an
    // app-scoped rule leaking across two apps that are supposed to be isolated.
    expect(() =>
      verticalB.registerRouterProvider(
        'solid-router',
        createFactory('B:solid-router'),
      ),
    ).toThrow(/competing router provider "tanstack"/);
  });

  it('(c) localDefault does not rescue the non-default vertical from (b)', async () => {
    const verticalA = await loadVerticalRuntime();
    verticalA.registerRouterProvider('react-router', createFactory('A:rr'), {
      isDefault: true,
    });
    verticalA.registerRouterProvider('tanstack', createFactory('A:tanstack'));

    const verticalB = await loadVerticalRuntime();
    const reactRouterB = createFactory('B:react-router');
    const solidRouterB = createFactory('B:solid-router');
    verticalB.registerRouterProvider('react-router', reactRouterB, {
      isDefault: true,
    });

    // 1. `localDefault` is a *resolve-time* option; it cannot prevent the
    //    *registration-time* throw. The real wrapper never even reaches resolve
    //    because register.ts already crashed on import.
    expect(() =>
      verticalB.registerRouterProvider('solid-router', solidRouterB),
    ).toThrow(/competing router provider "tanstack"/);

    // 2. Even if registration had somehow survived, the wrapper's localDefault
    //    (hardcoded to 'react-router' in internal.ts) only rescues the DEFAULT
    //    path. Driving the real wrapper contract for B's configured framework
    //    still fails to yield B's own provider:
    //    - framework 'solid-router' → not react-router, and 'solid-router' was
    //      never registered in this realm → Unknown-framework throw.
    expect(() =>
      resolveThroughRouterWrapper(verticalB, 'solid-router', reactRouterB),
    ).toThrow(/Unknown router framework "solid-router"/);

    // 3. The escape hatch demonstrably works *only* for the default provider:
    //    resolving the default path with a matching localDefault name does
    //    return B's own react-router. That is the full extent of the isolation
    //    the current model provides — it does not cover non-default verticals.
    expect(
      resolveThroughRouterWrapper(verticalB, undefined, reactRouterB),
    ).toBe(reactRouterB);
  });
});

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
 * just registry-identity, AND through the real production consumption path.
 * Vertical B resolves 'tanstack', invokes the resolved real factory, then — as
 * plugin-runtime internal.ts:49 does — calls `providerPlugin.setup(apiB)` with
 * a faithful vertical-B api. The empirical split:
 *   - HOOK channel is MASKED: setup pulls hooks solely from `api.getHooks()`
 *     (plugin.tsx:61), so B's hooks flow in; the closed-over `registryHooks`
 *     (A's) is metadata only and never drives runtime wiring.
 *   - MODULE-GRAPH channel LEAKS: the navigation primitives the provider
 *     publishes onto B's runtime context (`context.router.Link` from A's
 *     ./prefetchLink, `context.router.useMatches` from A's ./routeHooks) are
 *     A's module instances (identity-proven below). They cannot flow through
 *     the api argument, so api.getHooks() cannot mask them. The wrappers
 *     themselves are stateless delegators to @tanstack/react-router
 *     (prefetchLink.tsx delegates to useLinkProps; routeHooks.ts delegates to
 *     TanStack's useMatch/useMatches/useRouterState) — they do NOT close over
 *     @modern-js/runtime/context. In this harness @tanstack is shared, so
 *     wrapper identity capture alone does not demonstrate route-state
 *     divergence. In a real MF page each bundle ships its own @tanstack copy,
 *     so A's wrappers would resolve A's TanStack module (distinct React
 *     contexts) — whether that manifests as cross-state reads or a provider
 *     crash requires a two-remote integration fixture (Phase 2 / MV-G31 fix
 *     acceptance).
 * Net verdict: capture is real and unmaskable on this channel; severity in a
 * duplicated-@tanstack environment is deliberately left to the Phase 2
 * fixture. The scenario (b) registration crash below is a confirmed model
 * violation independent of this channel.
 * Honest harness note: rstest.resetModules() re-evaluates the workspace runtime
 * and this plugin's local src, but NOT the external @tanstack/react-router dep
 * (shared here), so the leak is proven through the per-vertical local wrappers.
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

      // Capture A's module-graph artifacts that A's factory closes over. Two
      // classes matter:
      //   1. LOCAL @modern-js/plugin-tanstack src wrappers (`Link` from
      //      ./prefetchLink, `useMatches` from ./routeHooks) — these are the
      //      navigation primitives the provider publishes onto context.router.
      //   2. The EXTERNAL @tanstack/react-router primitives (useRouter/
      //      useLocation/useNavigate).
      // Still A's generation here (no resetModules since A loaded), so these are
      // the same module objects A's plugin.tsx imported.
      const localA = {
        Link: (await import('../src/runtime/prefetchLink')).Link,
        useMatches: (await import('../src/runtime/routeHooks')).useMatches,
      };
      const tsrA = await import('@tanstack/react-router');

      // --- Vertical B: an INDEPENDENT real copy, one shared realm. ---
      const verticalB = await loadVertical();

      // B's own fresh copies (what B SHOULD have wired).
      const localB = {
        Link: (await import('../src/runtime/prefetchLink')).Link,
        useMatches: (await import('../src/runtime/routeHooks')).useMatches,
      };
      const tsrB = await import('@tanstack/react-router');

      // Distinct real module instances (two MF bundles). The workspace runtime
      // (@modern-js/runtime/context) and the LOCAL plugin src ARE re-evaluated
      // per vertical — those are the artifacts a leak can be traced through.
      expect(verticalB.context).not.toBe(verticalA.context);
      expect(verticalB.hooks).not.toBe(verticalA.hooks);
      expect(localB.Link).not.toBe(localA.Link);
      expect(localB.useMatches).not.toBe(localA.useMatches);
      // HARNESS LIMITATION, stated honestly: rstest.resetModules() does NOT
      // re-evaluate the external @tanstack/react-router dependency, so its
      // useRouter/useLocation/useNavigate are SHARED between A and B here and
      // cannot be used to distinguish a leak. In a real MF bundle @tanstack is
      // duplicated too, so those would also be A's copy — but this harness can
      // only prove the leak through the per-vertical local wrappers below.
      expect(tsrB.useRouter).toBe(tsrA.useRouter);

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
      // `registryHooks` is A's copy. But this property is METADATA only: it is
      // read by the plugin manager / `reportUnsupportedProviderRegistryHooks`,
      // never by the provider's own runtime wiring. On its own it does not prove
      // wrong-routing — the reviewer's objection. Kept as an identity anchor.
      expect(pluginForB.registryHooks).toBe(verticalA.hooks);
      expect(pluginForB.registryHooks).not.toBe(verticalB.hooks);

      // --- Drive the REAL production consumption path ---------------------
      // Production never reads `pluginForB.registryHooks`. It runs
      // `providerPlugin.setup(api)` (plugin-runtime internal.ts:49), and the
      // TanStack provider pulls its hooks from `api.getHooks()` (plugin.tsx:61).
      // So we must settle empirically: with a faithful vertical-B api, does B
      // end up wired to B's context, or to artifacts identity-bound to A?
      //
      // Build `apiB` exactly as production would (see internal.ts:24-49 +
      // pluginShared.getMergedRouterConfig): getHooks() returns B's hook set;
      // getRuntimeConfig() feeds config merge; onBeforeRender/wrapRoot capture
      // the provider's registered wiring. Node test env ⇒ `window` undefined, so
      // onBeforeRender takes the plain path that publishes `context.router`.
      const getHooksSpy = rstest.fn(() => verticalB.hooks);
      let capturedOnBeforeRender:
        | ((context: any, interrupt: (v?: unknown) => unknown) => unknown)
        | undefined;
      let capturedWrapRoot: ((App: any) => any) | undefined;
      const apiB = {
        getHooks: getHooksSpy,
        getRuntimeConfig: () => ({}),
        onBeforeRender: (listener: any) => {
          capturedOnBeforeRender = listener;
        },
        wrapRoot: (listener: any) => {
          capturedWrapRoot = listener;
        },
      };

      // Invoke setup the way internal.ts:49 does.
      (pluginForB as unknown as { setup: (api: any) => unknown }).setup(apiB);

      // HOOK CHANNEL — MASKED: setup consumed hooks strictly via api.getHooks(),
      // i.e. B's hook object. Nothing in setup reads the closed-over A hooks.
      expect(getHooksSpy).toHaveBeenCalled();
      expect(getHooksSpy.mock.results[0]?.value).toBe(verticalB.hooks);
      expect(typeof capturedOnBeforeRender).toBe('function');
      expect(typeof capturedWrapRoot).toBe('function');

      // MODULE-GRAPH CHANNEL — LEAKED: the navigation primitives the provider
      // publishes onto B's runtime context (`context.router`, consumed by B's
      // app to render Link and read route matches) are hard-closed over A's
      // local plugin module copy. api.getHooks() cannot mask these — they are
      // not hooks and never flow through the api argument.
      const contextForB: any = {};
      capturedOnBeforeRender?.(contextForB, () => undefined);
      expect(contextForB.router).toBeDefined();

      // Identity: B's published Link/useMatches are A's instances, never B's.
      // The wrappers are stateless delegators to @tanstack/react-router (shared
      // in this harness, per-bundle in real MF) — identity capture is proven
      // here; behavioral consequence under duplicated @tanstack is Phase 2's
      // two-remote fixture to establish.
      expect(contextForB.router.Link).toBe(localA.Link);
      expect(contextForB.router.useMatches).toBe(localA.useMatches);
      expect(contextForB.router.Link).not.toBe(localB.Link);
      expect(contextForB.router.useMatches).not.toBe(localB.useMatches);
      // VERDICT: capture confirmed, unmasked by api.getHooks(); hooks channel
      // masked. Severity under duplicated @tanstack copies is unproven in this
      // harness — recorded as Phase 2 (MV-G31) fix acceptance criterion.

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
    // NOTE: this scenario is a CONFIRMED realm-isolation violation on its own,
    // independent of (a)'s HARMFUL-vs-MASKED analysis. It proves the registry
    // *rejects* B outright — an app-scoped invariant enforced realm-globally —
    // at registration time, before any provider wiring is even reachable. The
    // synthetic throwing "solid" factory is acceptable here precisely because
    // the crash is registration-level: its body is never invoked, so no real
    // solid module graph is needed to demonstrate the leak.
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

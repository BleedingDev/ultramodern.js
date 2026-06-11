import { resolveRouterProvider } from '@modern-js/runtime/context';
import {
  Form,
  Link,
  NavLink,
  Outlet,
  RouteActionResponseError,
  useFetcher,
} from '../../src/runtime';
import { tanstackRouterCompatBindings } from '../../src/runtime/register';

const COMPAT_BINDINGS_SLOT = Symbol.for(
  '@modern-js/plugin-tanstack:runtime-compat-bindings',
);

describe("'@modern-js/plugin-tanstack/runtime' import side effects", () => {
  it('registers the tanstack router provider', () => {
    expect(typeof resolveRouterProvider('tanstack')).toBe('function');
  });

  it("publishes the compat bindings consumed by '@modern-js/runtime/tanstack-router'", () => {
    const bindings = (globalThis as Record<symbol, unknown>)[
      COMPAT_BINDINGS_SLOT
    ] as typeof tanstackRouterCompatBindings;

    expect(bindings).toBeDefined();
    expect(bindings).toBe(tanstackRouterCompatBindings);
    expect(bindings.Form).toBe(Form);
    expect(bindings.Link).toBe(Link);
    expect(bindings.NavLink).toBe(NavLink);
    expect(bindings.Outlet).toBe(Outlet);
    expect(bindings.RouteActionResponseError).toBe(RouteActionResponseError);
    expect(bindings.useFetcher).toBe(useFetcher);
  });

  it('keeps the first published bindings when a duplicate module copy evaluates', () => {
    // Simulates a Module Federation remote evaluating its own copy of
    // register.ts: `??=` must keep the established bindings.
    const host = globalThis as Record<symbol, unknown>;
    const established = host[COMPAT_BINDINGS_SLOT];
    expect(established).toBeDefined();

    host[COMPAT_BINDINGS_SLOT] ??= { duplicate: true };
    expect(host[COMPAT_BINDINGS_SLOT]).toBe(established);
  });
});

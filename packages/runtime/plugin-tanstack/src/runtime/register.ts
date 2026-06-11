/**
 * Registers the TanStack router provider with the @modern-js/runtime router
 * provider registry. Importing '@modern-js/plugin-tanstack/runtime' is enough
 * to make `runtime.router.framework: 'tanstack'` resolvable by the built-in
 * router runtime plugin.
 *
 * This module is intentionally side-effectful (see `sideEffects` in
 * package.json).
 */
import {
  type RouterProviderFactory,
  type RouterProviderPlugin,
  registerRouterProvider,
} from '@modern-js/runtime/context';
import { Form, RouteActionResponseError, useFetcher } from './dataMutation';
import { Outlet } from './outlet';
import { tanstackRouterPlugin } from './plugin';
import { Link, NavLink } from './prefetchLink';

// The TanStack runtime plugin types its API against its own hook registry,
// while the provider contract is typed against the built-in router hook
// registry of @modern-js/runtime. The two are runtime-compatible (the
// built-in router plugin registers the hooks and forwards its API to the
// resolved provider), but nominally distinct — hence the explicit adapter
// cast at this single boundary.
const tanstackRouterProviderFactory: RouterProviderFactory = userConfig =>
  tanstackRouterPlugin(userConfig) as unknown as RouterProviderPlugin;

registerRouterProvider('tanstack', tanstackRouterProviderFactory);

/**
 * Compatibility bindings for the deprecated `@modern-js/runtime/tanstack-router`
 * alias. `@modern-js/runtime` cannot depend on this package (the dependency
 * direction is plugin-tanstack -> runtime), so the alias resolves the
 * Modern.js specific bindings through this `Symbol.for` slot at use time.
 *
 * `??=` keeps the first copy: when Module Federation evaluates a second
 * bundled copy of this module, both copies are functionally identical and the
 * established registration wins (mirroring the router-provider registry).
 */
const COMPAT_BINDINGS_SLOT: unique symbol = Symbol.for(
  '@modern-js/plugin-tanstack:runtime-compat-bindings',
);

export const tanstackRouterCompatBindings = {
  Form,
  Link,
  NavLink,
  Outlet,
  RouteActionResponseError,
  useFetcher,
};

(
  globalThis as {
    [COMPAT_BINDINGS_SLOT]?: typeof tanstackRouterCompatBindings;
  }
)[COMPAT_BINDINGS_SLOT] ??= tanstackRouterCompatBindings;

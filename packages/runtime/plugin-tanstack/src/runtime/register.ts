/**
 * Registers TanStack router provider with the @modern-js/runtime router
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
import { tanstackRouterPlugin } from './plugin';

// TanStack runtime plugin types its API against its own hook registry,
// while the provider contract is typed against the built-in router hook
// registry from @modern-js/runtime. The two are runtime-compatible (the
// built-in router plugin registers the hooks and forwards its API to the
// resolved provider), but nominally distinct, so keep an explicit adapter
// cast as the single boundary.
const tanstackRouterProviderFactory: RouterProviderFactory = userConfig =>
  tanstackRouterPlugin(userConfig) as unknown as RouterProviderPlugin;

registerRouterProvider('tanstack', tanstackRouterProviderFactory);

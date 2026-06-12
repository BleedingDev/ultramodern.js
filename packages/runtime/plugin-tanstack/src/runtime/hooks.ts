/**
 * The router hooks are owned by @modern-js/runtime — this module re-exports
 * the canonical instances through the `/context` seam, so the TanStack
 * provider taps and calls the exact same hooks the built-in router wrapper
 * registers. Creating separate hook instances here would silently split the
 * hook registry between the wrapper and this provider.
 */
export {
  modifyRoutes,
  onAfterCreateRouter,
  onAfterHydrateRouter,
  onBeforeCreateRouter,
  onBeforeCreateRoutes,
  onBeforeHydrateRouter,
  type RouterExtendsHooks,
  routerProviderRegistryHooks,
} from '@modern-js/runtime/context';

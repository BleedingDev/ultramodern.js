import { type AnyRouter, RouterProvider } from '@octanejs/tanstack-router';
import { createElement, type ServerRenderNode } from 'octane/server';

// Request handlers and serialization belong to the selected native router.
export * from '@octanejs/tanstack-router/ssr/server';
export type { OctaneRequestHandlerOptions } from './router-handler';
export { createOctaneRequestHandler } from './router-handler';
export type { OctaneRouterInjectionOptions } from './router-injection';
export { createOctaneRouterInjection } from './router-injection';
export type {
  OctaneRouterSerializationGuard,
  OctaneRouterSerializationOptions,
} from './router-server-snapshot';
export { prepareOctaneRouterSerialization } from './router-server-snapshot';

/** Render the native provider using the released Start server root contract. */
export function OctaneRouterServer({
  router,
}: {
  router: AnyRouter;
}): ServerRenderNode {
  return createElement(RouterProvider, { router });
}

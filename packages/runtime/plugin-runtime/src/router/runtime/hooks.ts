import { createSyncHook } from '@modern-js/plugin';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { TRuntimeContext } from '../../core/context/runtime';
import type { RouterLifecycleContext } from './lifecycle';

export type RouterSyncHook<Handler extends (...args: any[]) => any> = {
  call: (...args: Parameters<Handler>) => ReturnType<Handler>;
  [key: string]: unknown;
};

const createRouterSyncHook = <Handler extends (...args: any[]) => any>() =>
  createSyncHook<Handler>() as RouterSyncHook<Handler>;

// only for inhouse use
const modifyRoutes =
  createRouterSyncHook<(routes: RouteObject[]) => RouteObject[]>();
const onBeforeCreateRoutes =
  createRouterSyncHook<(context: TRuntimeContext) => void>();
const onBeforeCreateRouter =
  createRouterSyncHook<(context: RouterLifecycleContext) => void>();
const onAfterCreateRouter =
  createRouterSyncHook<(context: RouterLifecycleContext) => void>();
const onBeforeHydrateRouter =
  createRouterSyncHook<(context: RouterLifecycleContext) => void>();
const onAfterHydrateRouter =
  createRouterSyncHook<(context: RouterLifecycleContext) => void>();

export {
  modifyRoutes,
  onAfterCreateRouter,
  onAfterHydrateRouter,
  onBeforeCreateRouter,
  onBeforeCreateRoutes,
  onBeforeHydrateRouter,
};

export type RouterExtendsHooks = {
  modifyRoutes: typeof modifyRoutes;
  onBeforeCreateRoutes: typeof onBeforeCreateRoutes;
  onBeforeCreateRouter: typeof onBeforeCreateRouter;
  onAfterCreateRouter: typeof onAfterCreateRouter;
  onBeforeHydrateRouter: typeof onBeforeHydrateRouter;
  onAfterHydrateRouter: typeof onAfterHydrateRouter;
};

// @effect-diagnostics globalConsole:off strictBooleanExpressions:off
import type { ShouldRevalidateFunction } from '@modern-js/runtime-utils/router';
import { ROUTE_MODULES } from '@modern-js/utils/universal/constants';
import type Module from 'module';

export const createShouldRevalidate =
  (routeId: string): ShouldRevalidateFunction =>
  arg => {
    const routeModule =
      typeof window !== 'undefined'
        ? window?.[ROUTE_MODULES as keyof Window]?.[routeId]
        : undefined;
    if (routeModule && typeof routeModule.shouldRevalidate === 'function') {
      return routeModule.shouldRevalidate(arg);
    }

    return arg.defaultShouldRevalidate;
  };

export const handleRouteModule = (routeModule: Module, routeId: string) => {
  if (typeof document !== 'undefined') {
    (window as any)[ROUTE_MODULES][routeId] = routeModule;
  }
  return routeModule;
};

export const handleRouteModuleError = (error: Error) => {
  console.error(error);
  return null;
};

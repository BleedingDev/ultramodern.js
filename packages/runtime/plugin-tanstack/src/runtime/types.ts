import type { RouteObject } from '@modern-js/runtime-utils/router';
import type React from 'react';

export type BuiltInRouterFramework = 'react-router' | 'tanstack';
export type RouterFramework = BuiltInRouterFramework | (string & {});

export type ModernRoute = {
  type: 'nested' | 'page';
  path?: string;
  id?: string;
  component?: React.ComponentType | string;
  children?: ModernRoute[];
  [key: string]: any;
};

export type RouterRouteMatchSnapshot = {
  routeId: string;
  assetRouteId?: string;
  pathname?: string;
  params?: Record<string, string>;
};

export type InternalRouterServerSnapshot = {
  framework?: RouterFramework;
  basename?: string;
  statusCode?: number;
  errors?: Record<string, unknown>;
  routerData?: {
    loaderData?: Record<string, unknown>;
    errors?: Record<string, unknown>;
  };
  hydrationScript?: string;
  hydrationScripts?: string[];
  matchedRouteIds?: string[];
  matches?: RouterRouteMatchSnapshot[];
};

export type InternalRouterRuntimeState = {
  framework: RouterFramework;
  basename?: string;
  instance?: unknown;
  hydrationScript?: string;
  hydrationScripts?: string[];
  matchedRouteIds?: string[];
  matches?: RouterRouteMatchSnapshot[];
  serverSnapshot?: InternalRouterServerSnapshot;
  cleanup?: () => void | Promise<void>;
};

/**
 * TanStack-specific router config. Unlike the react-router provider config,
 * this intentionally has no `oldVersion`/`future` fields — those are
 * react-router-only knobs with no meaning here.
 */
export type RouterConfig = {
  framework?: RouterFramework;
  routesConfig: {
    globalApp?: React.ComponentType<any>;
    routes?: ModernRoute[];
  };
  serverBase?: string[];
  supportHtml5History?: boolean;
  basename?: string;
  createRoutes?: () => RouteObject[];
  defaultStructuralSharing?: boolean;
  unstable_reloadOnURLMismatch?: boolean;
};

export const modernTanstackRouterFastDefaults = {
  defaultStructuralSharing: true,
} as const;

export const getModernTanstackRouterFastDefaults = (
  config: Partial<Pick<RouterConfig, 'defaultStructuralSharing'>> = {},
) => ({
  defaultStructuralSharing:
    config.defaultStructuralSharing ??
    modernTanstackRouterFastDefaults.defaultStructuralSharing,
});

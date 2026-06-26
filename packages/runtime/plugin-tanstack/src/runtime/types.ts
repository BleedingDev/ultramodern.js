import type {
  RouterFramework,
  // The router runtime state types are owned by @modern-js/runtime; they are
  // imported through the `/context` seam instead of being copied here so
  // upstream fixes propagate to this package automatically.
} from '@modern-js/runtime/context';
import type { RouteObject } from '@modern-js/runtime-utils/router';
import type { NestedRoute, PageRoute } from '@modern-js/types';
import type React from 'react';

export type {
  BuiltInRouterFramework,
  InternalRouterRuntimeState,
  InternalRouterServerSnapshot,
  RouterFramework,
  RouterRouteMatchSnapshot,
  RouterServerPrepareResult,
} from '@modern-js/runtime/context';

/**
 * TanStack-specific router config. Unlike the react-router provider config,
 * this intentionally has no `oldVersion`/`future` fields — those are
 * react-router-only knobs with no meaning here.
 */
export type RouterConfig = {
  framework?: RouterFramework;
  routesConfig: {
    globalApp?: React.ComponentType<any>;
    routes?: (NestedRoute | PageRoute)[];
  };
  serverBase?: string[];
  supportHtml5History?: boolean;
  basename?: string;
  createRoutes?: () => RouteObject[];
  defaultStructuralSharing?: boolean;
  unstable_reloadOnURLMismatch?: boolean;
};

export const modernTanstackRouterFastDefaults = {
  defaultStructuralSharing: false,
} as const;

export const getModernTanstackRouterFastDefaults = (
  config: Partial<Pick<RouterConfig, 'defaultStructuralSharing'>> = {},
) => ({
  defaultStructuralSharing:
    config.defaultStructuralSharing ??
    modernTanstackRouterFastDefaults.defaultStructuralSharing,
});

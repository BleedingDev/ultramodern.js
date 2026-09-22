import type React from 'react';

export type BuiltInRouterFramework = 'react-router' | 'tanstack';

export type RouterFramework = BuiltInRouterFramework | (string & {});

export interface RouterRouteMatchSnapshot {
  routeId: string;
  assetRouteId?: string;
  pathname?: string;
  params?: Record<string, string>;
}

export interface InternalRouterServerSnapshot {
  readonly framework?: RouterFramework;
  readonly basename?: string;
  readonly statusCode?: number;
  readonly errors?: Record<string, unknown>;
  readonly routerData?: {
    readonly loaderData?: Record<string, unknown>;
    readonly errors?: Record<string, unknown>;
  };
  readonly hydrationScripts?: readonly string[];
  readonly matchedRouteIds?: readonly string[];
  readonly matches?: readonly RouterRouteMatchSnapshot[];
}

export interface InternalRouterRuntimeState {
  framework: RouterFramework;
  basename?: string;
  instance?: unknown;
  navigation?: RouterNavigationCapability;
  cleanup?: () => void | Promise<void>;
}

export interface RouterServerPrepareResult {
  state: InternalRouterRuntimeState;
  snapshot?: InternalRouterServerSnapshot;
  cleanup?: () => void | Promise<void>;
}

export type RouterLifecyclePhase = 'ssr-prepare' | 'client-create' | 'hydrate';

/** Provider-owned browser navigation. Consumers never inspect router internals. */
export interface RouterNavigationSnapshot {
  location: { pathname: string; search: string; hash: string };
  params: Record<string, string>;
}

export interface RouterLinkTarget {
  pathname: string;
  href: string;
  search?: Record<string, unknown>;
  hash?: string;
  hashScrollIntoView?: boolean | ScrollIntoViewOptions;
  prefetch?: 'intent' | 'render' | 'viewport' | 'none';
  preload?: unknown;
}

export interface RouterNavigationCapability {
  getSnapshot: () => RouterNavigationSnapshot;
  subscribe: (listener: () => void) => () => void;
  navigate: (
    href: string,
    options?: { replace?: boolean; state?: unknown },
  ) => void | Promise<void>;
  Link: React.ComponentType<{
    to: string;
    children?: React.ReactNode;
    [key: string]: unknown;
  }>;
  createLinkProps?: (target: RouterLinkTarget) => {
    to: string;
    [key: string]: unknown;
  };
}

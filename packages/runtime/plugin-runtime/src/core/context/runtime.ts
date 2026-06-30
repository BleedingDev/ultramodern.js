import { createContext } from 'react';
import {
  ReactRuntimeContext,
  type RequestContext,
  RuntimeContext,
  type TRuntimeContext,
  useRuntimeContext,
} from './public';

const ROUTE_MANIFEST = '_MODERNJS_ROUTE_MANIFEST';

export type InternalSSRContext = {
  request: RequestContext['request'] & { raw?: Request };
  response: RequestContext['response'];
  [key: string]: any;
};

export {
  ReactRuntimeContext,
  RuntimeContext,
  type TRuntimeContext,
  useRuntimeContext,
} from './public';

/**
 * InternalRuntimeContext used internally and by plugins
 */
export interface TInternalRuntimeContext extends TRuntimeContext {
  routeManifest?: Record<string, unknown>;
  routerContext?: unknown;
  unstable_getBlockNavState?: () => boolean;
  ssrContext?: InternalSSRContext;
  _internalContext?: any;
  _internalRouterBaseName?: any;
}

export const InternalRuntimeContext = createContext<TInternalRuntimeContext>(
  {} as TInternalRuntimeContext,
);

export const getInitialContext = (
  isBrowser = true,
  routeManifest?: Record<string, unknown>,
): TInternalRuntimeContext => {
  const requestContext = {
    request: {},
    response: {},
  };
  return {
    isBrowser,
    routeManifest:
      routeManifest ||
      (typeof window !== 'undefined' && (window as any)[ROUTE_MANIFEST]),
    requestContext,
    context: requestContext, // deprecated, keep for backward compatibility
  };
};

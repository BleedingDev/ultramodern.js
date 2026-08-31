import type {
  RouteObject,
  StaticHandlerContext,
} from '@modern-js/runtime-utils/router';
import type { BaseSSRServerContext } from '@modern-js/types';
import { createContext } from 'react';
import type { RouteManifest } from '../../router/runtime/types';
import {
  ReactRuntimeContext,
  RuntimeContext,
  type TRuntimeContext,
  useRuntimeContext,
} from './public';

const ROUTE_MANIFEST = '_MODERNJS_ROUTE_MANIFEST';

export type InternalSSRContext = {
  request: BaseSSRServerContext['request'] & { raw?: Request };
  response: BaseSSRServerContext['response'];
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
  routeManifest?: RouteManifest;
  routes?: RouteObject[];
  routerContext?: StaticHandlerContext;
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
  routeManifest?: RouteManifest,
): TInternalRuntimeContext => {
  const requestContext = {
    request: {
      params: {},
      pathname: '',
      query: {},
      headers: {},
      host: '',
      url: '',
    },
    response: {
      setHeader() {},
      status() {},
      locals: {},
    },
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

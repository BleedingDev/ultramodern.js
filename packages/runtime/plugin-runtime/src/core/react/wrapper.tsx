import type React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import {
  getGlobalEnableRsc,
  InternalRuntimeContext,
  RuntimeContext,
  type TInternalRuntimeContext,
  type TRuntimeContext,
} from '../context';
import { stripRuntimeContextExtensions } from '../context/extensions';
import { ensureHelmetContext } from '../context/helmetContext';

function toRscSafeRecord(value: unknown) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(Object.entries(value as Record<string, unknown>));
}

function createRscSafeSsrContext(
  ssrContext: TInternalRuntimeContext['ssrContext'],
): TInternalRuntimeContext['ssrContext'] {
  if (!ssrContext) {
    return ssrContext;
  }

  const { request } = ssrContext;

  return {
    nonce: ssrContext.nonce,
    useJsonScript: ssrContext.useJsonScript,
    htmlModifiers: [],
    baseUrl: ssrContext.baseUrl,
    request: request
      ? {
          url: request.url,
          userAgent: request.userAgent,
          cookie: request.cookie,
          pathname: request.pathname,
          query: toRscSafeRecord(request.query),
          params: toRscSafeRecord(request.params),
          headers: toRscSafeRecord(request.headers),
          host: request.host,
          referer: request.referer,
        }
      : request,
    mode: ssrContext.mode,
    loaderFailureMode: ssrContext.loaderFailureMode,
  } as TInternalRuntimeContext['ssrContext'];
}

function createRscSafeRequestContext(
  ssrContext: TInternalRuntimeContext['ssrContext'],
): TInternalRuntimeContext['requestContext'] {
  const safeSsrContext = createRscSafeSsrContext(ssrContext);

  return {
    request: safeSsrContext?.request || {},
    response: {
      locals: ssrContext?.response?.locals || {},
    },
  } as TInternalRuntimeContext['requestContext'];
}

export function wrapRuntimeContextProvider(
  App: React.ReactElement,
  contextValue: TRuntimeContext,
) {
  const {
    isBrowser,
    initialData,
    routes,
    context,
    routeManifest,
    routerContext,
    unstable_getBlockNavState,
    ssrContext,
    _internalContext,
    _internalRouterBaseName,
    ...rest
  } = contextValue as TInternalRuntimeContext;

  const internalContextValue = contextValue as TInternalRuntimeContext;
  const helmetContext = ensureHelmetContext(internalContextValue);

  const runtimeContextValue: TRuntimeContext = {
    isBrowser,
    initialData,
    routes,
    context,
    ...rest,
  };
  // Rest patterns copy enumerable symbol-keyed properties too, so the
  // internal extension slot (router instance, helmet state, ...) would ride
  // into the public context — strip it from the public copy. Internal readers
  // keep using `internalContextValue`, which is the original object.
  stripRuntimeContextExtensions(runtimeContextValue);

  if (getGlobalEnableRsc() && !isBrowser) {
    const rscSafeRequestContext = createRscSafeRequestContext(ssrContext);
    const rscInternalContextValue = {
      ...internalContextValue,
      context: rscSafeRequestContext,
      requestContext: rscSafeRequestContext,
      ssrContext: createRscSafeSsrContext(ssrContext),
    };
    const rscRuntimeContextValue = {
      ...runtimeContextValue,
      context: rscSafeRequestContext,
      requestContext: rscSafeRequestContext,
    };

    return (
      <InternalRuntimeContext.Provider value={rscInternalContextValue}>
        <RuntimeContext.Provider value={rscRuntimeContextValue}>
          {App}
        </RuntimeContext.Provider>
      </InternalRuntimeContext.Provider>
    );
  }

  return (
    <InternalRuntimeContext.Provider value={internalContextValue}>
      <RuntimeContext.Provider value={runtimeContextValue}>
        <HelmetProvider context={helmetContext}>{App}</HelmetProvider>
      </RuntimeContext.Provider>
    </InternalRuntimeContext.Provider>
  );
}

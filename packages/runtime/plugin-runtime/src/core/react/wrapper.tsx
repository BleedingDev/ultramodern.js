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

function createRscSafeRequestContext(
  ssrContext: TInternalRuntimeContext['ssrContext'],
): TInternalRuntimeContext['requestContext'] {
  if (ssrContext === undefined) {
    return {
      request: {},
      response: { locals: {} },
    };
  }

  const { request, response } = ssrContext;

  return {
    request: {
      url: request.url,
      userAgent: request.userAgent,
      cookie: request.cookie,
      pathname: request.pathname,
      query: { ...request.query },
      params: { ...request.params },
      headers: { ...request.headers },
      host: request.host,
      referer: request.referer,
    },
    response: {
      locals: response.locals ?? {},
    },
  };
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

  if (getGlobalEnableRsc() === true && isBrowser === false) {
    const rscSafeRequestContext = createRscSafeRequestContext(ssrContext);
    const rscInternalContextValue = {
      ...internalContextValue,
      context: rscSafeRequestContext,
      requestContext: rscSafeRequestContext,
    };
    delete rscInternalContextValue.ssrContext;
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

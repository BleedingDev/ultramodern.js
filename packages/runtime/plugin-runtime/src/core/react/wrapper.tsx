import type React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import {
  InternalRuntimeContext,
  RuntimeContext,
  type TInternalRuntimeContext,
  type TRuntimeContext,
} from '../context';
import { ensureHelmetContext } from '../context/helmetContext';

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

  return (
    <InternalRuntimeContext.Provider value={internalContextValue}>
      <RuntimeContext.Provider value={runtimeContextValue}>
        <HelmetProvider context={helmetContext}>{App}</HelmetProvider>
      </RuntimeContext.Provider>
    </InternalRuntimeContext.Provider>
  );
}

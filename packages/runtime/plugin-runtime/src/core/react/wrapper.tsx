import type React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import {
  InternalRuntimeContext,
  RuntimeContext,
  type TInternalRuntimeContext,
  type TRuntimeContext,
} from '../context';

export function wrapRuntimeContextProvider(
  App: React.ReactElement,
  contextValue: TRuntimeContext,
) {
  const {
    isBrowser,
    initialData,
    routes,
    routerFramework,
    context,
    routeManifest,
    routerRuntime,
    routerInstance,
    routerHydrationScript,
    routerMatchedRouteIds,
    routerServerSnapshot,
    routerContext,
    unstable_getBlockNavState,
    ssrContext,
    _internalContext,
    _internalRouterBaseName,
    _helmetContext,
    ...rest
  } = contextValue as TInternalRuntimeContext;

  const internalContextValue = contextValue as TInternalRuntimeContext;
  internalContextValue._helmetContext ??= {};

  const runtimeContextValue: TRuntimeContext = {
    isBrowser,
    initialData,
    routes,
    routerFramework,
    context,
    ...rest,
  };

  return (
    <InternalRuntimeContext.Provider value={internalContextValue}>
      <RuntimeContext.Provider value={runtimeContextValue}>
        <HelmetProvider context={internalContextValue._helmetContext}>
          {App}
        </HelmetProvider>
      </RuntimeContext.Provider>
    </InternalRuntimeContext.Provider>
  );
}

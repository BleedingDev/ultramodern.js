import type { ResolveComponentFn } from '@modern-js/plugin/runtime';
import {
  getGlobalEnableRsc,
  getGlobalInternalRuntimeContext,
  InternalRuntimeContext,
  RuntimeComponentResolverContext,
  RuntimeContext,
  type TInternalRuntimeContext,
  type TRuntimeContext,
} from '@modern-js/runtime/context';
import type React from 'react';

export function wrapRuntimeComponentResolver(
  root: React.ReactNode,
  hooks:
    | { resolveComponent?: { call: ResolveComponentFn } }
    | undefined = getGlobalInternalRuntimeContext()?.hooks,
): React.ReactElement {
  return (
    <RuntimeComponentResolverContext.Provider
      value={hooks?.resolveComponent?.call}
    >
      {root}
    </RuntimeComponentResolverContext.Provider>
  );
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

  const runtimeContextValue: TRuntimeContext = {
    isBrowser,
    initialData,
    routes,
    context,
    ...rest,
  };
  const isRsc = getGlobalEnableRsc() === true;
  const projection = {
    internalContext: contextValue as TInternalRuntimeContext,
    publicContext: runtimeContextValue,
  };
  const values =
    getGlobalInternalRuntimeContext()?.hooks.transformRuntimeContext?.call(
      projection,
      { context: contextValue, isRsc },
    ) ?? projection;

  const root = (
    <InternalRuntimeContext.Provider value={values.internalContext}>
      <RuntimeContext.Provider value={values.publicContext}>
        {App}
      </RuntimeContext.Provider>
    </InternalRuntimeContext.Provider>
  );
  // RSC server callers install the resolver only at their HTML renderer;
  // its callback must never become part of the tree passed to Flight.
  return isRsc && isBrowser === false
    ? root
    : wrapRuntimeComponentResolver(root);
}

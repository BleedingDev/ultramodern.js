import { RuntimeContext } from '@modern-js/runtime';
import { InternalRuntimeContext } from '@modern-js/runtime/context';
import {
  getRouterRuntimeState,
  type RouterLinkTarget,
  type RouterNavigationCapability,
  type RouterNavigationSnapshot,
  subscribeRouterRuntimeState,
} from '@modern-js/runtime-extensions/router-state';
import type React from 'react';
import { useCallback, useContext, useSyncExternalStore } from 'react';

export interface I18nRouterNavigationDependencies<
  Adapter extends I18nRouterAdapterShape,
> {
  I18nNavigationProvider: React.ComponentType<
    React.PropsWithChildren<{ value: Adapter }>
  >;
  useNativeI18nRouterAdapter: () => Adapter;
}

export type I18nRouterLinkTarget = RouterLinkTarget;

export interface I18nRouterAdapterShape {
  framework?: string;
  hasRouter: boolean;
  location: RouterNavigationSnapshot['location'] | null;
  navigate: RouterNavigationCapability['navigate'] | null;
  Link: RouterNavigationCapability['Link'] | null;
  params: Record<string, string>;
  createLinkProps?: RouterNavigationCapability['createLinkProps'];
}

const subscribeNone = () => () => {};
const getEmptySnapshot = () => null;

/** The router provider owns navigation; this seam only observes its capability. */
export const createI18nRouterNavigation = <
  Adapter extends I18nRouterAdapterShape,
>({
  I18nNavigationProvider,
  useNativeI18nRouterAdapter,
}: I18nRouterNavigationDependencies<Adapter>) => {
  // The injected context accepts null to preserve native-router fallback.
  const NavigationProvider = I18nNavigationProvider as React.ComponentType<
    React.PropsWithChildren<{ value: Adapter | null }>
  >;
  const useIntegratedRouterAdapter = (): Adapter => {
    const runtimeContext = useContext(RuntimeContext);
    const internalContext = useContext(InternalRuntimeContext);
    const native = useNativeI18nRouterAdapter();
    const getCapability = useCallback(
      () =>
        getRouterRuntimeState(internalContext)?.navigation ??
        getRouterRuntimeState(runtimeContext)?.navigation,
      [internalContext, runtimeContext],
    );
    const subscribeCapability = useCallback(
      (update: () => void) => {
        const stopInternal = subscribeRouterRuntimeState(
          internalContext,
          update,
        );
        const stopPublic =
          internalContext === runtimeContext
            ? undefined
            : subscribeRouterRuntimeState(runtimeContext, update);
        return () => {
          stopInternal();
          stopPublic?.();
        };
      },
      [internalContext, runtimeContext],
    );
    // Separate subscriptions handle both delayed installation/replacement and
    // navigation inside the currently selected provider, without hook guessing.
    const capability = useSyncExternalStore(
      subscribeCapability,
      getCapability,
      getCapability,
    );
    const snapshot = useSyncExternalStore(
      capability?.subscribe ?? subscribeNone,
      capability?.getSnapshot ?? getEmptySnapshot,
      capability?.getSnapshot ?? getEmptySnapshot,
    );
    if (native.hasRouter || !capability || !snapshot) {
      return native;
    }
    const internalState = getRouterRuntimeState(internalContext);
    return {
      framework:
        internalState?.navigation === capability
          ? internalState.framework
          : getRouterRuntimeState(runtimeContext)?.framework,
      hasRouter: true,
      ...snapshot,
      navigate: capability.navigate,
      Link: capability.Link,
      createLinkProps: capability.createLinkProps,
    } as Adapter;
  };

  const I18nRouterNavigationProvider = ({
    children,
  }: React.PropsWithChildren) => {
    const value = useIntegratedRouterAdapter();
    const native = useNativeI18nRouterAdapter();
    // Keep the router subtree mounted when a capability arrives or disappears.
    return (
      <NavigationProvider
        value={value.hasRouter && !native.hasRouter ? value : null}
      >
        {children}
      </NavigationProvider>
    );
  };

  return { useIntegratedRouterAdapter, I18nRouterNavigationProvider };
};

import {
  InternalRuntimeContext,
  RuntimeContext,
} from '@modern-js/runtime/context';
import {
  applyRouterRuntimeState,
  type RouterNavigationCapability,
} from '@modern-js/runtime-extensions/router-state';
import React, { act, createContext, useContext, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createI18nRouterNavigation,
  type I18nRouterAdapterShape,
} from '../src/router-navigation/adapter';

test('late navigation installation preserves the mounted router and native fallback', async () => {
  rstest.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const context = {} as React.ContextType<typeof InternalRuntimeContext>;
  const navigationContext = createContext<I18nRouterAdapterShape | null>(null);
  const native: I18nRouterAdapterShape = {
    hasRouter: false,
    location: null,
    navigate: null,
    Link: null,
    params: {},
  };
  const { I18nRouterNavigationProvider } = createI18nRouterNavigation({
    I18nNavigationProvider: navigationContext.Provider,
    useNativeI18nRouterAdapter: () => native,
  });
  const snapshot = {
    location: { pathname: '/cs/produkty/bota', search: '', hash: '' },
    params: { lang: 'cs', slug: 'bota' },
  };
  const navigation: RouterNavigationCapability = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    navigate: () => {},
    Link: () => null,
  };
  const mounted = rstest.fn();
  const unmounted = rstest.fn();
  const Router = () => {
    const adapter = useContext(navigationContext);
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return <p>{adapter?.location?.pathname ?? 'native fallback'}</p>;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <InternalRuntimeContext.Provider value={context}>
          <RuntimeContext.Provider value={context}>
            <I18nRouterNavigationProvider>
              <Router />
            </I18nRouterNavigationProvider>
          </RuntimeContext.Provider>
        </InternalRuntimeContext.Provider>,
      );
    });
    expect(container.textContent).toBe('native fallback');
    await act(async () => {
      applyRouterRuntimeState(context, { framework: 'tanstack', navigation });
    });
    expect(container.textContent).toBe('/cs/produkty/bota');
    await act(async () => {
      applyRouterRuntimeState(context, { navigation: undefined });
    });
    expect(container.textContent).toBe('native fallback');
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    rstest.unstubAllGlobals();
  }
});

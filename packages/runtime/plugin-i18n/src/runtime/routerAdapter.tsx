import { I18nNavigationContext } from '@modern-js/plugin-i18n/runtime/contexts';
import { isBrowser, RuntimeContext } from '@modern-js/runtime';
import { InternalRuntimeContext } from '@modern-js/runtime/context';
import type React from 'react';
import { useContext } from 'react';

interface I18nRouterLocation {
  pathname: string;
  search: string;
  hash: string;
}

type I18nRouterNavigate = (
  href: string,
  options?: { replace?: boolean; state?: unknown },
) => void | Promise<void>;

type I18nRouterLink = React.ComponentType<{
  to: string;
  children?: React.ReactNode;
  [key: string]: unknown;
}>;

export interface I18nRouterLinkTarget {
  pathname: string;
  href: string;
  search?: Record<string, unknown>;
  hash?: string;
  hashScrollIntoView?: boolean | ScrollIntoViewOptions;
  prefetch?: 'intent' | 'render' | 'viewport' | 'none';
  preload?: unknown;
}

export interface I18nRouterAdapter {
  framework?: string;
  hasRouter: boolean;
  location: I18nRouterLocation | null;
  navigate: I18nRouterNavigate | null;
  Link: I18nRouterLink | null;
  params: Record<string, string>;
  /** Convert an already resolved target to the selected router's own props. */
  createLinkProps?: (target: I18nRouterLinkTarget) => {
    to: string;
    [key: string]: unknown;
  };
}

export const I18nNavigationProvider = ({
  children,
  value,
}: React.PropsWithChildren<{ value: I18nRouterAdapter }>) => (
  <I18nNavigationContext.Provider value={value}>
    {children}
  </I18nNavigationContext.Provider>
);

interface NativeRouterApi {
  useInRouterContext?: () => boolean;
  useNavigate?: () => I18nRouterNavigate;
  useLocation?: () => I18nRouterLocation;
  useParams?: () => Record<string, string>;
  Link?: I18nRouterLink;
}

/** Read native router hooks only when their own provider is present. */
export const useNativeI18nRouterAdapter = (): I18nRouterAdapter => {
  const runtimeContext = useContext(RuntimeContext);
  const internalContext = useContext(InternalRuntimeContext);
  const routerApi = (internalContext.router || runtimeContext.router) as
    | NativeRouterApi
    | undefined;
  const hasRouter = routerApi?.useInRouterContext?.() ?? false;
  const navigate = hasRouter ? (routerApi?.useNavigate?.() ?? null) : null;
  const routerLocation = hasRouter
    ? (routerApi?.useLocation?.() ?? null)
    : null;
  const params = hasRouter ? (routerApi?.useParams?.() ?? {}) : {};
  const location =
    routerLocation ??
    (isBrowser()
      ? {
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash,
        }
      : null);

  return {
    framework: hasRouter ? 'react-router' : undefined,
    hasRouter,
    navigate,
    location,
    params,
    Link: hasRouter ? (routerApi?.Link ?? null) : null,
  };
};

export const useI18nRouterAdapter = (): I18nRouterAdapter => {
  const provided = useContext(I18nNavigationContext);
  const native = useNativeI18nRouterAdapter();
  return provided ?? native;
};

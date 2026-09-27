// @effect-diagnostics asyncFunction:off globalConsole:off globalTimers:off strictBooleanExpressions:off unnecessaryArrowBlock:off
'use client';
import {
  matchRoutes,
  type Path,
  type RouteObject,
  Link as RouterLink,
  type LinkProps as RouterLinkProps,
  NavLink as RouterNavLink,
  type NavLinkProps as RouterNavLinkProps,
  useHref,
  useMatches,
  useResolvedPath,
} from '@modern-js/runtime-utils/router';
import type {
  FocusEventHandler,
  MouseEventHandler,
  Ref,
  TouchEventHandler,
} from 'react';
import React, { useContext, useMemo } from 'react';
import { InternalRuntimeContext } from '../../core/context';
import type { RouteAssets, RouteManifest } from './types';

declare const WEBPACK_CHUNK_LOAD:
  | ((chunkId: string | number) => Promise<unknown>)
  | undefined;
const getWebpackChunkLoader = (): typeof WEBPACK_CHUNK_LOAD =>
  typeof WEBPACK_CHUNK_LOAD === 'function' ? WEBPACK_CHUNK_LOAD : undefined;
const getWebpackPublicPath = () => {
  try {
    return __webpack_public_path__ || '';
  } catch {
    return '';
  }
};

interface PrefetchHandlers {
  onFocus?: FocusEventHandler<Element>;
  onBlur?: FocusEventHandler<Element>;
  onMouseEnter?: MouseEventHandler<Element>;
  onMouseLeave?: MouseEventHandler<Element>;
  onTouchStart?: TouchEventHandler<Element>;
}

function composeEventHandlers<EventType extends React.SyntheticEvent | Event>(
  theirHandler: ((event: EventType) => any) | undefined,
  ourHandler: (event: EventType) => any,
): (event: EventType) => any {
  return event => {
    theirHandler?.(event);
    if (!event.defaultPrevented) {
      ourHandler(event);
    }
  };
}

/**
 * Modified from https://github.com/remix-run/remix/blob/9a0601bd704d2f3ee622e0ddacab9b611eb0c5bc/packages/remix-react/components.tsx#L218
 *
 * MIT Licensed
 * Author Michael Jackson
 * Copyright 2021 Remix Software Inc.
 * https://github.com/remix-run/remix/blob/2b5e1a72fc628d0408e27cf4d72e537762f1dc5b/LICENSE.md
 */
/**
 * Defines the prefetching behavior of the link:
 *
 * - "intent": Fetched when the user focuses or hovers the link
 * - "render": Fetched when the link is rendered
 * - "viewport": Fetched when the link enters the viewport
 * - "none": Never fetched
 */
type PrefetchBehavior = NonNullable<RouterLinkProps['prefetch']>;
type PreloadBehavior = PrefetchBehavior | false;
const ABSOLUTE_URL_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

export interface LinkProps extends RouterLinkProps {
  prefetch?: PrefetchBehavior;
  preload?: PreloadBehavior;
}
export interface NavLinkProps extends RouterNavLinkProps {
  prefetch?: PrefetchBehavior;
  preload?: PreloadBehavior;
}

/** Optional scheduling capability supplied by a runtime integration. */
export interface LinkPrefetchPolicy {
  observe(options: {
    element: HTMLAnchorElement | null;
    prefetch?: PrefetchBehavior;
    preload?: PreloadBehavior;
    notify: (state: { code: boolean; data: boolean }) => void;
  }): {
    onIntent: () => void;
    onCancel: () => void;
    dispose: () => void;
  };
  schedule(options: {
    runtimeContext: object;
    chunkLoader: object;
    publicPath: string;
    key: string;
    run: () => Promise<unknown>;
  }): () => void;
  canWarmup: () => boolean;
  allowData: (route: RouteObject) => boolean;
}

const setRef = <T,>(ref: Ref<T> | undefined, value: T | null) => {
  if (!ref) {
    return;
  }

  if (typeof ref === 'function') {
    ref(value);
    return;
  }

  try {
    (ref as React.MutableRefObject<T | null>).current = value;
  } catch {
    // React will report invalid ref usage; warmup should not make it worse.
  }
};

/**
 * Modified from https://github.com/remix-run/remix/blob/9a0601bd704d2f3ee622e0ddacab9b611eb0c5bc/packages/remix-react/components.tsx#L236
 *
 * MIT Licensed
 * Author Michael Jackson
 * Copyright 2021 Remix Software Inc.
 * https://github.com/remix-run/remix/blob/2b5e1a72fc628d0408e27cf4d72e537762f1dc5b/LICENSE.md
 */
function usePrefetchBehavior(
  prefetch: PrefetchBehavior | undefined,
  preload: PreloadBehavior | undefined,
  theirElementProps: PrefetchHandlers,
  policy: LinkPrefetchPolicy | undefined,
): [
  boolean,
  boolean,
  Required<PrefetchHandlers>,
  (element: HTMLAnchorElement | null) => void,
] {
  const [maybePrefetch, setMaybePrefetch] = React.useState(false);
  const [state, setState] = React.useState({ code: false, data: false });
  const [element, setElement] = React.useState<HTMLAnchorElement | null>(null);
  const observerRef = React.useRef<
    ReturnType<LinkPrefetchPolicy['observe']> | undefined
  >(undefined);
  const { onFocus, onBlur, onMouseEnter, onMouseLeave, onTouchStart } =
    theirElementProps;

  React.useEffect(() => {
    if (!policy) {
      setState({ code: prefetch === 'render', data: prefetch === 'render' });
      return;
    }
    const observer = policy.observe({
      element,
      prefetch,
      preload,
      notify: next =>
        setState(previous =>
          previous.code === next.code && previous.data === next.data
            ? previous
            : next,
        ),
    });
    observerRef.current = observer;
    return () => {
      observerRef.current = undefined;
      observer.dispose();
    };
  }, [policy, prefetch, preload, element]);

  React.useEffect(() => {
    if (policy || !maybePrefetch) {
      return;
    }
    const timer = setTimeout(() => setState({ code: true, data: true }), 100);
    return () => clearTimeout(timer);
  }, [policy, maybePrefetch]);

  const setIntent = () => {
    if (policy) {
      observerRef.current?.onIntent();
    } else if (prefetch === 'intent') {
      setMaybePrefetch(true);
    }
  };
  const cancelIntent = () => {
    if (policy) {
      observerRef.current?.onCancel();
    } else if (prefetch === 'intent') {
      setMaybePrefetch(false);
      setState({ code: false, data: false });
    }
  };
  return [
    state.data,
    state.code,
    {
      onFocus: composeEventHandlers(onFocus, setIntent),
      onBlur: composeEventHandlers(onBlur, cancelIntent),
      onMouseEnter: composeEventHandlers(onMouseEnter, setIntent),
      onMouseLeave: composeEventHandlers(onMouseLeave, cancelIntent),
      onTouchStart: composeEventHandlers(onTouchStart, setIntent),
    },
    setElement,
  ];
}

async function loadRouteModule(
  route: RouteObject,
  routeAssets: RouteAssets,
  chunkLoader: NonNullable<typeof WEBPACK_CHUNK_LOAD>,
): Promise<string[] | void> {
  const routeId = route.id;
  if (!routeId) {
    return;
  }

  if (!routeAssets[routeId]) {
    return;
  }

  const { chunkIds } = routeAssets[routeId];

  if (!chunkIds) {
    return;
  }

  try {
    await Promise.all(
      chunkIds.map(chunkId => {
        return chunkLoader(chunkId);
      }),
    );
  } catch (error) {
    console.error(error);
    throw error;
  }
}

const getRequestUrl = (pathname: string, routeId: string) => {
  const LOADER_ID_PARAM = '__loader';
  const DIRECT_PARAM = '__ssrDirect';
  const { protocol, host } = window.location;
  const url = new URL(pathname, `${protocol}//${host}`);
  url.searchParams.append(LOADER_ID_PARAM, routeId);
  url.searchParams.append(DIRECT_PARAM, 'true');
  return url;
};

const createDataHref = (href: string) => {
  return <link key={href} rel="prefetch" as="fetch" href={href} />;
};

const getDataHref = (
  route: RouteObject,
  pathname: string,
  basename: string,
) => {
  const { id } = route;

  const path = basename === '/' ? pathname : `${basename}${pathname}`;

  const url = getRequestUrl(path, id!);
  return createDataHref(url.toString());
};

const PrefetchPageLinks: React.FC<{ path: Path; includeData: boolean }> = ({
  path,
  includeData,
}) => {
  const { pathname } = path;
  const context = useContext(InternalRuntimeContext);
  const { routeManifest, routes } = context;
  const { routeAssets } = routeManifest || {};
  const policy = context.linkPrefetchPolicy;
  const allowNetworkWarmup = policy?.canWarmup() ?? true;
  const matches = useMemo(
    () => (Array.isArray(routes) ? matchRoutes(routes, pathname) : []),
    [pathname, routes],
  );
  const chunkLoader = getWebpackChunkLoader();
  const routeAssetGeneration = JSON.stringify([
    getWebpackPublicPath(),
    matches?.map(({ route: { id } }) => [id, routeAssets?.[id!]?.chunkIds]),
  ]);

  React.useEffect(() => {
    if (
      !allowNetworkWarmup ||
      !Array.isArray(matches) ||
      !routeAssets ||
      !chunkLoader
    ) {
      return;
    }

    const cancellations = matches.map(match => {
      const routeId = match.route.id;
      const routeAsset = routeId ? routeAssets[routeId] : undefined;
      const chunkIds = routeAsset?.chunkIds;

      if (!routeId || !Array.isArray(chunkIds) || chunkIds.length === 0) {
        return () => {};
      }

      const run = () => loadRouteModule(match.route, routeAssets, chunkLoader);
      if (policy) {
        return policy.schedule({
          runtimeContext: context,
          chunkLoader,
          publicPath: getWebpackPublicPath(),
          key: `route-module:${routeId}:${chunkIds.join(',')}`,
          run,
        });
      }
      void run().catch(() => {});
      return () => {};
    });

    return () => {
      cancellations.forEach(cancel => cancel());
    };
  }, [allowNetworkWarmup, chunkLoader, context, policy, routeAssetGeneration]);

  if (!allowNetworkWarmup || !includeData || !window._SSR_DATA) {
    return null;
  }

  return (
    <PrefetchDataLinks
      matches={matches}
      path={path}
      routeManifest={routeManifest!}
    />
  );
};

const PrefetchDataLinks: React.FC<{
  matches: ReturnType<typeof matchRoutes>;
  path: Path;
  routeManifest: RouteManifest;
}> = ({ matches, path, routeManifest }) => {
  const { pathname, search, hash } = path;
  const policy = useContext(InternalRuntimeContext).linkPrefetchPolicy;
  const currentMatches = useMatches();
  const basename = useHref('/');
  const dataHrefs = useMemo(() => {
    return matches
      ?.filter((match, index) => {
        if (
          policy?.allowData(match.route) === false ||
          !match.route.loader ||
          typeof match.route.loader !== 'function' ||
          match.route.loader.length === 0
        ) {
          return false;
        }

        if (match.route.shouldRevalidate) {
          const currentUrl = new URL(
            location.pathname + location.search + location.hash,
            window.origin,
          );
          const nextUrl = new URL(pathname + search + hash, window.origin);
          const shouldLoad = match.route.shouldRevalidate({
            currentUrl,
            currentParams: currentMatches[0]?.params || {},
            nextUrl,
            nextParams: match.params,
            defaultShouldRevalidate: true,
          });

          if (typeof shouldLoad === 'boolean') {
            return shouldLoad;
          }
        }

        const currentMatch = currentMatches[index];
        if (!currentMatch || currentMatch.id !== match.route.id) {
          return true;
        }
        if (currentMatch.pathname !== match.pathname) {
          return true;
        }
        if (
          currentMatch.pathname.endsWith('*') &&
          currentMatch.params['*'] !== match.params['*']
        ) {
          return true;
        }
        return false;
      })
      .map(match => getDataHref(match.route, pathname, basename));
  }, [matches, pathname, routeManifest]);

  return <>{dataHrefs}</>;
};

type InputLinkProps<T> = T extends typeof RouterNavLink
  ? NavLinkProps
  : T extends typeof RouterLink
    ? LinkProps
    : never;

const createPrefetchLink = <T extends typeof RouterLink | typeof RouterNavLink>(
  Link: T,
) => {
  return React.forwardRef<HTMLAnchorElement, InputLinkProps<T>>(
    ({ to, prefetch, preload, ...props }, forwardedRef) => {
      const isAbsolute = typeof to === 'string' && ABSOLUTE_URL_REGEX.test(to);
      const policy = useContext(InternalRuntimeContext).linkPrefetchPolicy;
      const [
        shouldPrefetch,
        shouldPreload,
        prefetchHandlers,
        setViewportElement,
      ] = usePrefetchBehavior(prefetch, preload, props, policy);
      const setAnchorRef = React.useCallback(
        (element: HTMLAnchorElement | null) => {
          setViewportElement(element);
          setRef(forwardedRef, element);
        },
        [forwardedRef, setViewportElement],
      );

      const resolvedPath = useResolvedPath(to);
      return (
        <>
          <Link
            ref={setAnchorRef}
            to={to}
            {...(props as any)}
            {...prefetchHandlers}
          />
          {(shouldPrefetch || shouldPreload) && !isAbsolute ? (
            <PrefetchPageLinks
              path={resolvedPath}
              includeData={shouldPrefetch}
            />
          ) : null}
        </>
      );
    },
  );
};

const Link = createPrefetchLink<typeof RouterLink>(RouterLink);
Link.displayName = 'Link';

const NavLink = createPrefetchLink<typeof RouterNavLink>(RouterNavLink);
NavLink.displayName = 'NavLink';

export { Link, NavLink };

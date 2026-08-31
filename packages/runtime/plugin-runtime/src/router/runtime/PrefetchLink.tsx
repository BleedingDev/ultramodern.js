// @effect-diagnostics asyncFunction:off globalConsole:off globalTimers:off strictBooleanExpressions:off unnecessaryArrowBlock:off
'use client';
import { getNavigationWarmupCacheKey } from '@modern-js/runtime-extensions';
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
    // @ts-expect-error Webpack supplies this runtime value.
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
type PrefetchBehavior = 'intent' | 'render' | 'viewport' | 'none';
type PreloadBehavior = PrefetchBehavior | false;
const ABSOLUTE_URL_REGEX = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const DEFAULT_PREFETCH_BEHAVIOR: PrefetchBehavior = 'render';
const INTENT_DELAY = 100;
const VIEWPORT_ROOT_MARGIN = '200px';
const MAX_CONCURRENT_WARMUPS = 4;
const WARMUP_TTL = 30_000;
const SLOW_EFFECTIVE_TYPES = new Set(['slow-2g', '2g']);

export interface LinkProps extends RouterLinkProps {
  prefetch?: PrefetchBehavior;
  preload?: PreloadBehavior;
}
export interface NavLinkProps extends RouterNavLinkProps {
  prefetch?: PrefetchBehavior;
  preload?: PreloadBehavior;
}

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

interface NavigationWarmupHandle {
  navigationWarmup?: {
    data?: boolean;
  };
}

type WarmupTask = {
  key: string;
  run: () => Promise<unknown>;
  cancelled: boolean;
};

const warmupCache = new Map<string, number>();
const warmupQueue: WarmupTask[] = [];
let activeWarmups = 0;

const getWarmupTimestamp = () => performance.now();

const getConnection = (): NetworkInformationLike | undefined => {
  const nav = globalThis.navigator as
    | (Navigator & {
        connection?: NetworkInformationLike;
        mozConnection?: NetworkInformationLike;
        webkitConnection?: NetworkInformationLike;
      })
    | undefined;

  return nav?.connection || nav?.mozConnection || nav?.webkitConnection;
};

const shouldWarmupOnCurrentNetwork = () => {
  const connection = getConnection();

  if (connection?.saveData) {
    return false;
  }

  if (
    typeof connection?.effectiveType === 'string' &&
    SLOW_EFFECTIVE_TYPES.has(connection.effectiveType)
  ) {
    return false;
  }

  return true;
};

const pruneWarmupCache = (now = getWarmupTimestamp()) => {
  for (const [key, timestamp] of warmupCache) {
    if (now - timestamp > WARMUP_TTL) {
      warmupCache.delete(key);
    }
  }
};

const runNextWarmup = () => {
  while (activeWarmups < MAX_CONCURRENT_WARMUPS && warmupQueue.length > 0) {
    const task = warmupQueue.shift()!;

    if (task.cancelled) {
      continue;
    }

    activeWarmups += 1;
    task
      .run()
      .catch(() => {
        warmupCache.delete(task.key);
      })
      .finally(() => {
        activeWarmups -= 1;
        runNextWarmup();
      });
  }
};

const scheduleWarmup = (key: string, run: () => Promise<unknown>) => {
  if (!shouldWarmupOnCurrentNetwork()) {
    return () => {};
  }

  pruneWarmupCache();

  if (warmupCache.has(key)) {
    return () => {};
  }

  warmupCache.set(key, getWarmupTimestamp());

  const task: WarmupTask = {
    key,
    run,
    cancelled: false,
  };

  warmupQueue.push(task);
  runNextWarmup();

  return () => {
    task.cancelled = true;
    if (warmupQueue.includes(task)) {
      warmupCache.delete(task.key);
    }
  };
};

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

const isDataWarmupEnabled = (route: RouteObject) => {
  const handle = (route as RouteObject & { handle?: NavigationWarmupHandle })
    .handle;

  return handle?.navigationWarmup?.data !== false;
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
  prefetch: PrefetchBehavior,
  preload: PrefetchBehavior,
  theirElementProps: PrefetchHandlers,
): [
  boolean,
  boolean,
  Required<PrefetchHandlers>,
  (element: HTMLAnchorElement | null) => void,
] {
  const [maybeWarmup, setMaybeWarmup] = React.useState(false);
  const [shouldPrefetch, setShouldPrefetch] = React.useState(false);
  const [shouldPreload, setShouldPreload] = React.useState(false);
  const [viewportElement, setViewportElement] =
    React.useState<HTMLAnchorElement | null>(null);
  const { onFocus, onBlur, onMouseEnter, onMouseLeave, onTouchStart } =
    theirElementProps;

  React.useEffect(() => {
    if (prefetch === 'render') {
      setShouldPrefetch(true);
    }

    if (preload === 'render') {
      setShouldPreload(true);
    }
  }, [prefetch, preload]);

  const setIntent = () => {
    if (prefetch === 'intent' || preload === 'intent') {
      setMaybeWarmup(true);
    }
  };

  const cancelIntent = () => {
    if (prefetch === 'intent' || preload === 'intent') {
      setMaybeWarmup(false);
      setShouldPrefetch(false);
      setShouldPreload(false);
    }
  };

  React.useEffect(() => {
    if (maybeWarmup) {
      const id = setTimeout(() => {
        if (prefetch === 'intent') {
          setShouldPrefetch(true);
        }

        if (preload === 'intent') {
          setShouldPreload(true);
        }
      }, INTENT_DELAY);
      return () => {
        clearTimeout(id);
      };
    }
  }, [maybeWarmup, prefetch, preload]);

  React.useEffect(() => {
    if (
      !viewportElement ||
      (prefetch !== 'viewport' && preload !== 'viewport') ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) {
          return;
        }

        if (prefetch === 'viewport') {
          setShouldPrefetch(true);
        }

        if (preload === 'viewport') {
          setShouldPreload(true);
        }

        observer.disconnect();
      },
      {
        rootMargin: VIEWPORT_ROOT_MARGIN,
      },
    );

    observer.observe(viewportElement);

    return () => {
      observer.disconnect();
    };
  }, [prefetch, preload, viewportElement]);

  return [
    shouldPrefetch,
    shouldPreload,
    {
      onFocus: composeEventHandlers(onFocus, setIntent),
      onBlur: composeEventHandlers(onBlur, cancelIntent),
      onMouseEnter: composeEventHandlers(onMouseEnter, setIntent),
      onMouseLeave: composeEventHandlers(onMouseLeave, cancelIntent),
      onTouchStart: composeEventHandlers(onTouchStart, setIntent),
    },
    setViewportElement,
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
  const allowNetworkWarmup = shouldWarmupOnCurrentNetwork();
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

      return scheduleWarmup(
        getNavigationWarmupCacheKey(
          context,
          chunkLoader,
          getWebpackPublicPath(),
          `route-module:${routeId}:${chunkIds.join(',')}`,
        ),
        () => loadRouteModule(match.route, routeAssets, chunkLoader),
      );
    });

    return () => {
      cancellations.forEach(cancel => cancel());
    };
  }, [allowNetworkWarmup, chunkLoader, context, routeAssetGeneration]);

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
  const currentMatches = useMatches();
  const basename = useHref('/');
  const dataHrefs = useMemo(() => {
    return matches
      ?.filter((match, index) => {
        if (
          !isDataWarmupEnabled(match.route) ||
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

const normalizePreloadBehavior = (
  preload: PreloadBehavior | undefined,
  prefetch: PrefetchBehavior,
) => {
  if (preload === false || preload === 'none') {
    return 'none';
  }

  if (typeof preload !== 'undefined') {
    return preload;
  }

  if (prefetch === 'none') {
    return 'none';
  }

  return prefetch;
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
    (
      { to, prefetch = DEFAULT_PREFETCH_BEHAVIOR, preload, ...props },
      forwardedRef,
    ) => {
      const isAbsolute = typeof to === 'string' && ABSOLUTE_URL_REGEX.test(to);
      const resolvedPreload = normalizePreloadBehavior(preload, prefetch);
      const [
        shouldPrefetch,
        shouldPreload,
        prefetchHandlers,
        setViewportElement,
      ] = usePrefetchBehavior(prefetch, resolvedPreload, props);
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

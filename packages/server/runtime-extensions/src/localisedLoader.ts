import type { LoaderRouteIdResolver } from '@modern-js/plugin-data-loader/runtime';
import { resolveLocalisedLoaderRouteId } from '@modern-js/runtime-extensions/localised-loader-identity';
import { applyLocalisedUrlsToRoutes } from '@modern-js/runtime-extensions/localised-urls';
import type { ServerLoaderBundle } from '@modern-js/server-core';

type LoaderRoutes = ServerLoaderBundle['routes'];

/**
 * Project canonical-only localized routes so loader matching sees every
 * localized URL. Routes already emitted as physical localized aliases are
 * returned unchanged.
 *
 * Runtime-neutral: shared by the Node server plugin and the Cloudflare worker
 * route data handler.
 */
export function expandLocalisedLoaderRoutes(
  routes: LoaderRoutes,
): LoaderRoutes {
  const languages = new Set<string>();
  const localisedUrls: Record<string, Record<string, string>> = {};
  let physical = false;
  const visit = (nodes: LoaderRoutes) => {
    for (const route of nodes) {
      physical ||= 'modernCanonicalPath' in route;
      const identity = Reflect.get(route, 'modernLocalisedRoute') as
        | { canonicalPath: string; paths?: Record<string, string> }
        | undefined;
      if (identity?.paths) {
        localisedUrls[identity.canonicalPath] = identity.paths;
        for (const language of Object.keys(identity.paths))
          languages.add(language);
      }
      if ('children' in route && route.children) visit(route.children);
    }
  };
  visit(routes);
  return physical || languages.size === 0
    ? routes
    : (applyLocalisedUrlsToRoutes(
        routes,
        [...languages],
        localisedUrls,
      ) as LoaderRoutes);
}

/** Resolve a canonical loader route ID to the localized alias matched by the URL. */
export const resolveLocalisedLoaderRoute: LoaderRouteIdResolver = (
  requestedRouteId,
  { routes, matchedRouteIds },
) => resolveLocalisedLoaderRouteId(routes, requestedRouteId, matchedRouteIds);

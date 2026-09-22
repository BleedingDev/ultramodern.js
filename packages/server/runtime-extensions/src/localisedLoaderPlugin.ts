import { setLoaderRouteIdResolver } from '@modern-js/plugin-data-loader/runtime';
import { resolveLocalisedLoaderRouteId } from '@modern-js/runtime-extensions/localised-loader-identity';
import { applyLocalisedUrlsToRoutes } from '@modern-js/runtime-extensions/localised-urls';
import {
  getLoaderCtx,
  type MiddlewareHandler,
  type ServerLoaderBundle,
  type ServerPlugin,
} from '@modern-js/server-core';

function expandCanonicalRoutes(routes: ServerLoaderBundle['routes']) {
  const languages = new Set<string>();
  const localisedUrls: Record<string, Record<string, string>> = {};
  let physical = false;
  const visit = (nodes: ServerLoaderBundle['routes']) => {
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
      ) as typeof routes);
}

export function injectLocalisedLoaderPlugin(): ServerPlugin {
  return {
    name: '@modern-js/localised-loader',
    setup(api) {
      const handler: MiddlewareHandler = async (context, next) => {
        setLoaderRouteIdResolver(
          getLoaderCtx(context),
          (requestedRouteId, { routes, matchedRouteIds }) =>
            resolveLocalisedLoaderRouteId(
              routes,
              requestedRouteId,
              matchedRouteIds,
            ),
          expandCanonicalRoutes,
        );
        await next();
      };
      api.onPrepare(() => {
        api.getServerContext().middlewares.push({
          name: 'localised-loader-route-id',
          before: ['render'],
          handler,
        });
      });
    },
  };
}

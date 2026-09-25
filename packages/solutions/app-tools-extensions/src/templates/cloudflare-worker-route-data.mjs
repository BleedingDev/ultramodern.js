import {
  expandLocalisedLoaderRoutes,
  resolveLocalisedLoaderRoute,
} from '@modern-js/server-runtime-extensions/localised-loader';

/**
 * Answer Modern.js route data requests (`?__loader=`) inside the Cloudflare
 * worker with the entry's server loader bundle, like the Node server's data
 * handler: same loader runtime, same localized route identity.
 */
export function createRouteDataRequestHandler(serverLoaderModule) {
  let loaderRuntime;

  const loadRuntime = () => {
    loaderRuntime ??= Promise.resolve(
      typeof serverLoaderModule.loadModules === 'function'
        ? serverLoaderModule.loadModules()
        : serverLoaderModule,
    ).catch(error => {
      loaderRuntime = undefined;
      throw error;
    });
    return loaderRuntime;
  };

  return async ({ request, serverRoutes }) => {
    const { handleRequest, routes, setLoaderRouteIdResolver } =
      await loadRuntime();
    const loaderContext = new Map();
    setLoaderRouteIdResolver(
      loaderContext,
      resolveLocalisedLoaderRoute,
      expandLocalisedLoaderRoutes,
    );

    return handleRequest({
      request,
      serverRoutes,
      routes,
      context: { loaderContext },
    });
  };
}

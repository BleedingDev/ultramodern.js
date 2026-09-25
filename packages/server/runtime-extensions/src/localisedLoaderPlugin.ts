import { setLoaderRouteIdResolver } from '@modern-js/plugin-data-loader/runtime';
import {
  getLoaderCtx,
  type MiddlewareHandler,
  type ServerPlugin,
} from '@modern-js/server-core';
import {
  expandLocalisedLoaderRoutes,
  resolveLocalisedLoaderRoute,
} from './localisedLoader';

export function injectLocalisedLoaderPlugin(): ServerPlugin {
  return {
    name: '@modern-js/localised-loader',
    setup(api) {
      const handler: MiddlewareHandler = async (context, next) => {
        setLoaderRouteIdResolver(
          getLoaderCtx(context),
          resolveLocalisedLoaderRoute,
          expandLocalisedLoaderRoutes,
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

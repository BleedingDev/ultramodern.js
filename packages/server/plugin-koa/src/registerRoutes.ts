// @effect-diagnostics asyncFunction:off
import type Router from '@koa/router';
import { type APIHandlerInfo, planApiRoutes } from '@modern-js/bff-core';
import { createRouteHandler } from './utils';

const registerRoutes = (router: Router, handlerInfos: APIHandlerInfo[]) => {
  planApiRoutes(handlerInfos).forEach(({ method, routePath, handler }) => {
    // `@koa/router` adds verbs from `http.METHODS` at runtime; the typings
    // only declare the common ones plus a string index signature.
    const register = router[method];
    if (typeof register !== 'function') {
      throw new Error(
        `[plugin-koa] @koa/router does not support HTTP method "${method}"`,
      );
    }
    register.call(router, routePath, createRouteHandler(handler));
  });
};

export default registerRoutes;

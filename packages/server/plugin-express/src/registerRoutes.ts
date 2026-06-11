// @effect-diagnostics asyncFunction:off
import 'reflect-metadata';
import { type APIHandlerInfo, planApiRoutes } from '@modern-js/bff-core';
import type { Express, RequestHandler } from 'express';
import { createRouteHandler } from './utils';

const registerRoutes = (app: Express, handlerInfos: APIHandlerInfo[]) => {
  planApiRoutes<RequestHandler>(handlerInfos).forEach(
    ({ method, routePath, handler, middlewares }) => {
      const routeHandler = createRouteHandler(handler);
      if (middlewares.length > 0) {
        app[method](routePath, middlewares, routeHandler);
      } else {
        app[method](routePath, routeHandler);
      }
    },
  );
};

export default registerRoutes;

import 'reflect-metadata';
import type { APIHandlerInfo } from '@modern-js/bff-core';
import type { Express } from 'express';
import { createRouteHandler } from './utils';

const registerRoutes = (app: Express, handlerInfos: APIHandlerInfo[]) => {
  handlerInfos.forEach(({ routePath, handler, httpMethod }) => {
    const routeHandler = createRouteHandler(handler as any);
    const method = httpMethod.toLowerCase();
    const routeMiddlwares = Reflect.getMetadata('middleware', handler) || [];
    if (routeMiddlwares.length > 0) {
      (app as any)[method](routePath, routeMiddlwares, routeHandler);
    } else {
      (app as any)[method](routePath, routeHandler);
    }
  });
};

export default registerRoutes;

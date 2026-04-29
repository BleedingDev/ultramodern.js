import type Router from '@koa/router';
import type { APIHandlerInfo } from '@modern-js/bff-core';
import { createRouteHandler } from './utils';

const registerRoutes = (router: Router, handlerInfos: APIHandlerInfo[]) => {
  handlerInfos.forEach(({ routePath, handler, httpMethod }) => {
    const routeHandler = createRouteHandler(handler as any);
    const method = httpMethod.toLowerCase();
    (router as any)[method](routePath, routeHandler);
  });
};

export default registerRoutes;

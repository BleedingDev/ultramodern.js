// @effect-diagnostics asyncFunction:off strictBooleanExpressions:off
import type { APIHandlerInfo } from '@modern-js/bff-core';
import type {
  Context,
  MiddlewareHandler,
  ServerMiddleware,
  ServerPluginAPI,
} from '@modern-js/server-core';
import { logger } from '@modern-js/utils';

import createHonoRoutes from '../../utils/createHonoRoutes';
import {
  checkCrossProjectPolicyResponse,
  type ResolvedCrossProjectPolicy,
  resolveAdapterCrossProjectPolicy,
} from '../../utils/crossProjectServerPolicy';
import { createSafeFailureResponse } from '../safe-failure';

const before = ['custom-server-hook', 'custom-server-middleware', 'render'];

interface MiddlewareOptions {
  prefix?: string;
  enableHandleWeb?: boolean;
}

export class HonoAdapter {
  apiMiddleware: ServerMiddleware[] = [];
  api: ServerPluginAPI;
  isHono = true;
  prefix = '/api';
  crossProjectPolicy: ResolvedCrossProjectPolicy | undefined;
  constructor(api: ServerPluginAPI) {
    this.api = api;
  }

  setHandlers = async () => {
    if (!this.isHono) {
      return;
    }
    const { apiHandlerInfos } = this.api.getServerContext();

    const honoHandlers = createHonoRoutes(apiHandlerInfos as APIHandlerInfo[]);
    this.apiMiddleware = honoHandlers.map(({ path, method, handler }) => ({
      name: 'hono-bff-api',
      path,
      method,
      handler: this.withErrorBoundary(handler),
      order: 'post',
      before,
    }));

    this.crossProjectPolicy = resolveAdapterCrossProjectPolicy(
      this.api,
      (apiHandlerInfos as APIHandlerInfo[]) || [],
    );
    if (this.crossProjectPolicy) {
      // Enforce the cross-project policy ahead of every BFF route. Without
      // this middleware the generated SDK's force-enabled policy config was
      // a silent no-op in the hono lane.
      const policyMiddleware: MiddlewareHandler = async (c, next) => {
        const denial = checkCrossProjectPolicyResponse(
          c.req.header(),
          this.crossProjectPolicy,
        );
        if (denial) {
          return denial;
        }
        await next();
      };
      this.apiMiddleware.unshift({
        name: 'bff-cross-project-policy',
        path: `${this.prefix}/*`,
        method: 'all',
        handler: policyMiddleware,
        order: 'post',
        before,
      });
    }
  };

  /**
   * Register the BFF API routes as ordinary server middlewares.
   *
   * Dev and prod now share this single path: the routes are pushed straight
   * into the server's middleware list. In dev, hot updates are handled by the
   * unified `@modern-js/server` runtime reload (which rebuilds the whole
   * runtime — including this plugin — from scratch), so BFF no longer needs its
   * own swappable Hono sub-app / dynamic dispatch middleware.
   */
  registerMiddleware = async (options: MiddlewareOptions = {}) => {
    const { bffRuntimeFramework } = this.api.getServerContext();

    if (bffRuntimeFramework !== 'hono') {
      this.isHono = false;
      return;
    }

    const { prefix } = options;
    this.prefix = prefix || this.prefix;

    const { middlewares: globalMiddlewares } = this.api.getServerContext();

    await this.setHandlers();

    globalMiddlewares.push(...this.apiMiddleware);
  };

  private handleRouteError = async (error: unknown, c: Context) => {
    try {
      const onErrorHandler = this.api.getServerConfig()?.onError;
      if (onErrorHandler) {
        const result = await onErrorHandler(error as Error, c);
        if (result instanceof Response) {
          return result;
        }
      } else {
        logger.error(error);
      }
    } catch (configError) {
      logger.error(`Error in serverConfig.onError handler: ${configError}`);
    }
    return createSafeFailureResponse(error);
  };

  private withErrorBoundary = (
    handler: MiddlewareHandler | MiddlewareHandler[],
  ): MiddlewareHandler | MiddlewareHandler[] => {
    const handlers = Array.isArray(handler) ? handler : [handler];
    const [firstHandler, ...restHandlers] = handlers;
    if (!firstHandler) {
      return handler;
    }
    const boundary: MiddlewareHandler = async (c, next) => {
      try {
        return await firstHandler(c, next);
      } catch (error) {
        return this.handleRouteError(error, c);
      }
    };
    return Array.isArray(handler) ? [boundary, ...restHandlers] : boundary;
  };
}

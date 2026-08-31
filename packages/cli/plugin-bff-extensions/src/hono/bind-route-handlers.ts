import { createSafeFailureResponse } from '@modern-js/runtime-extensions/safe-failure';
import type { Context, MiddlewareHandler } from '@modern-js/server-core';

import type { ResolvedCrossProjectPolicy } from '../cross-project-policy/evaluation';
import { createHonoCrossProjectPolicyMiddleware } from './cross-project-policy';

export interface BindHonoRouteHandlersOptions {
  handler: MiddlewareHandler | MiddlewareHandler[];
  policy?: ResolvedCrossProjectPolicy;
  routePath: string;
  onError?: (error: Error, context: Context) => unknown | Promise<unknown>;
  reportError?: (error: unknown) => void;
}

export const bindHonoRouteHandlers = ({
  handler,
  policy,
  routePath,
  onError,
  reportError,
}: BindHonoRouteHandlersOptions): MiddlewareHandler | MiddlewareHandler[] => {
  const handlers = Array.isArray(handler) ? handler : [handler];
  const [firstHandler, ...restHandlers] = handlers;
  let routeHandlers: MiddlewareHandler | MiddlewareHandler[] = handler;

  if (firstHandler) {
    const errorBoundary: MiddlewareHandler = async (context, next) => {
      try {
        return await firstHandler(context, next);
      } catch (error) {
        try {
          if (onError) {
            const result = await onError(error as Error, context);
            if (result instanceof Response) {
              return result;
            }
          } else {
            reportError?.(error);
          }
        } catch (configError) {
          reportError?.(
            `Error in serverConfig.onError handler: ${configError}`,
          );
        }

        return createSafeFailureResponse(error);
      }
    };
    routeHandlers = Array.isArray(handler)
      ? [errorBoundary, ...restHandlers]
      : errorBoundary;
  }

  if (!policy) {
    return routeHandlers;
  }

  return [
    createHonoCrossProjectPolicyMiddleware(policy, routePath),
    ...(Array.isArray(routeHandlers) ? routeHandlers : [routeHandlers]),
  ];
};

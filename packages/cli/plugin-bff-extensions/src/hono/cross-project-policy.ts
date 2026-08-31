import type { MiddlewareHandler } from '@modern-js/server-core';

import {
  checkCrossProjectPolicyResponse,
  type ResolvedCrossProjectPolicy,
} from '../cross-project-policy/evaluation';

export const createHonoCrossProjectPolicyMiddleware = (
  policy: ResolvedCrossProjectPolicy,
  routePath: string,
): MiddlewareHandler =>
  async function honoCrossProjectPolicyMiddleware(context, next) {
    const denial = checkCrossProjectPolicyResponse(
      context.req.header(),
      policy,
      {
        method: context.req.method,
        routePath,
      },
    );
    if (denial) {
      return denial;
    }

    return next();
  };

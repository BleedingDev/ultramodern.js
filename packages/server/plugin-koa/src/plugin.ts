import Router from '@koa/router';
import {
  type APIHandlerInfo,
  buildOperationContractMap,
  evaluateCrossProjectPolicy,
} from '@modern-js/bff-core';
import type { ServerPlugin } from '@modern-js/server-core';
import { compatRequire, fs } from '@modern-js/utils';
import type Application from 'koa';
import Koa, { type Middleware } from 'koa';
import koaBody from 'koa-body';
import * as path from 'path';
import { run } from './context';
import registerRoutes from './registerRoutes';

interface FrameConfig {
  middleware: (Middleware | string)[];
}

const findAppModule = async (apiDir: string) => {
  const exts = ['.ts', '.js'];
  const paths = exts.map(ext => path.join(apiDir, `app${ext}`));

  for (const filename of paths) {
    if (await fs.pathExists(filename)) {
      // 每次获取 app.ts 的时候，避免使用缓存的 app.ts
      delete require.cache[filename];
      return compatRequire(filename);
    }
  }

  return null;
};

const initMiddlewares = (
  middleware: (Middleware | string)[],
  app: Application,
) => {
  middleware.forEach(middlewareItem => {
    const middlewareFunc =
      typeof middlewareItem === 'string'
        ? compatRequire(middlewareItem)
        : middlewareItem;
    app.use(middlewareFunc);
  });
};

const applyCrossProjectPolicy = (
  app: Application,
  crossProjectPolicy: Record<string, unknown> | undefined,
) => {
  if (!crossProjectPolicy || !crossProjectPolicy.enabled) {
    return;
  }

  app.use(async (ctx, next) => {
    const violation = evaluateCrossProjectPolicy(
      ctx.request.headers as Record<string, unknown>,
      crossProjectPolicy as any,
    );
    if (violation) {
      ctx.status = violation.status;
      ctx.body = {
        code: violation.code,
        reason: violation.reason,
        message: violation.message,
      };
      return;
    }
    await next();
  });
};

const resolveCrossProjectPolicy = (input: {
  crossProjectPolicy?: Record<string, unknown>;
  apiHandlerInfos: APIHandlerInfo[];
  requestId?: string;
  isCrossProjectServer?: boolean;
}) => {
  const {
    crossProjectPolicy,
    apiHandlerInfos,
    requestId,
    isCrossProjectServer,
  } = input;
  if (!crossProjectPolicy && !isCrossProjectServer) {
    return undefined;
  }

  const policy = (crossProjectPolicy || {}) as Record<string, any>;
  const effectiveRequestId =
    typeof requestId === 'string' && requestId.trim().length > 0
      ? requestId
      : 'default';
  const generatedContracts = buildOperationContractMap({
    handlers: apiHandlerInfos,
    requestId: effectiveRequestId,
  });

  return {
    ...policy,
    enabled: policy.enabled ?? Boolean(isCrossProjectServer),
    requireEnvelope: policy.requireEnvelope ?? true,
    requireOperationContext: policy.requireOperationContext ?? true,
    requireOperationContextDetails:
      policy.requireOperationContextDetails ?? true,
    requireOperationSchemaHash: policy.requireOperationSchemaHash ?? true,
    requireOperationVersion: policy.requireOperationVersion ?? true,
    allowUnknownOperations: policy.allowUnknownOperations ?? false,
    expectedOperationContracts: {
      ...(policy.expectedOperationContracts || {}),
      ...generatedContracts,
    },
  };
};

export default (): ServerPlugin => ({
  name: '@modern-js/plugin-koa',
  pre: ['@modern-js/plugin-bff'],
  post: ['@modern-js/plugin-server'],
  setup: api => ({
    async prepareApiServer({ pwd, config, render }) {
      let app: Application;
      const router = new Router();
      const apiDir = path.join(pwd, './api');
      const appContext = api.useAppContext();
      const apiHandlerInfos = appContext.apiHandlerInfos as APIHandlerInfo[];
      const mode = appContext.apiMode;
      const userConfig = api.useConfigContext();
      const rawCrossProjectPolicy = userConfig.bff?.crossProjectPolicy as
        | Record<string, unknown>
        | undefined;
      const crossProjectPolicy = resolveCrossProjectPolicy({
        crossProjectPolicy: rawCrossProjectPolicy,
        apiHandlerInfos,
        requestId: userConfig.bff?.requestId,
        isCrossProjectServer: userConfig.bff?.isCrossProjectServer,
      });

      if (mode === 'framework') {
        app = await findAppModule(apiDir);
        if (!(app instanceof Koa)) {
          app = new Koa();
          app.use(
            koaBody({
              multipart: true,
            }),
          );
        }
        applyCrossProjectPolicy(app, crossProjectPolicy);

        if (config) {
          const { middleware } = config as FrameConfig;
          initMiddlewares(middleware, app);
        }

        app.use(run);
        registerRoutes(router, apiHandlerInfos);
      } else if (mode === 'function') {
        app = new Koa();
        app.use(
          koaBody({
            multipart: true,
          }),
        );
        applyCrossProjectPolicy(app, crossProjectPolicy);
        if (config) {
          const { middleware } = config as FrameConfig;
          initMiddlewares(middleware, app);
        }

        app.use(run);
        registerRoutes(router, apiHandlerInfos);
      } else {
        throw new Error(`mode must be function or framework`);
      }

      app.use(router.routes());
      if (userConfig.bff?.enableHandleWeb && render) {
        app.use(async (ctx, next) => {
          const html = await render(ctx.req, ctx.res);
          if (html) {
            ctx.body = html;
          }
          await next();
        });
      }

      return (req, res) => {
        return Promise.resolve(app.callback()(req, res));
      };
    },
    prepareWebServer({ config }, next) {
      const userConfig = api.useConfigContext();
      if (!userConfig?.server?.enableFrameworkExt) {
        return next();
      }
      const app: Application = new Koa();

      app.use(async (ctx, next) => {
        await next();
        if (!ctx.body) {
          // restore statusCode
          if (
            ctx.res.statusCode === 404 &&
            !(ctx.response as any)._explicitStatus
          ) {
            ctx.res.statusCode = 200;
          }
          ctx.respond = false;
        }
      });

      app.use(koaBody());
      if (config) {
        const { middleware } = config as FrameConfig;
        initMiddlewares(middleware, app);
      }

      return ctx => {
        const {
          source: { req, res },
        } = ctx;
        app.on('error', err => {
          if (err) {
            throw err;
          }
        });
        return Promise.resolve(app.callback()(req, res));
      };
    },
  }),
});

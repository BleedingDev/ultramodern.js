import Router from '@koa/router';
import {
  type APIHandlerInfo,
  type CrossProjectPolicyConfig,
  checkCrossProjectPolicy,
  resolveCrossProjectPolicy,
} from '@modern-js/bff-core';
import type { ServerConfig, ServerPlugin } from '@modern-js/server-core';
import { fs } from '@modern-js/utils';
import type Application from 'koa';
import Koa, { type Middleware } from 'koa';
import koaBody from 'koa-body';
import * as path from 'path';
import { run } from './context';
import registerRoutes from './registerRoutes';

interface FrameConfig {
  middleware: (Middleware | string)[];
}

/**
 * Sync CJS require with ESM-default interop. `@modern-js/utils` removed the
 * old `compatRequire` export; this preserves its behavior for loading user
 * `api/app.{ts,js}` modules and string middlewares.
 */
const requireWithInterop = (filePath: string) => {
  const mod = require(filePath);
  return mod?.__esModule ? mod.default : mod;
};

const findAppModule = async (apiDir: string) => {
  const exts = ['.ts', '.js'];
  const paths = exts.map(ext => path.join(apiDir, `app${ext}`));

  for (const filename of paths) {
    if (await fs.pathExists(filename)) {
      // 每次获取 app.ts 的时候，避免使用缓存的 app.ts
      delete require.cache[filename];
      return requireWithInterop(filename);
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
        ? requireWithInterop(middlewareItem)
        : middlewareItem;
    app.use(middlewareFunc);
  });
};

const applyCrossProjectPolicy = (
  app: Application,
  crossProjectPolicy: CrossProjectPolicyConfig | undefined,
) => {
  if (!crossProjectPolicy?.enabled) {
    return;
  }

  app.use(async (ctx, next) => {
    const denial = checkCrossProjectPolicy(
      ctx.request.headers,
      crossProjectPolicy,
    );
    if (denial) {
      ctx.status = denial.status;
      ctx.body = denial.body;
      return;
    }
    await next();
  });
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
      const userConfig: ServerConfig = api.useConfigContext();
      const bffConfig = userConfig.bff;
      const crossProjectPolicy = resolveCrossProjectPolicy({
        crossProjectPolicy: bffConfig?.crossProjectPolicy,
        handlers: apiHandlerInfos,
        requestId: bffConfig?.requestId,
        isCrossProjectServer: bffConfig?.isCrossProjectServer,
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
      const userConfig: ServerConfig = api.useConfigContext();
      if (!userConfig?.server?.enableFrameworkExt) {
        return next();
      }
      const app: Application = new Koa();

      app.use(async (ctx, next) => {
        await next();
        if (!ctx.body) {
          // restore statusCode
          const response = ctx.response as unknown as {
            _explicitStatus?: boolean;
          };
          if (ctx.res.statusCode === 404 && !response._explicitStatus) {
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

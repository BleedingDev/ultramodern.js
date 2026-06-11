// @effect-diagnostics asyncFunction:off newPromise:off nodeBuiltinImport:off strictBooleanExpressions:off

import Router from '@koa/router';
import {
  type APIHandlerInfo,
  type CrossProjectPolicyConfig,
  checkCrossProjectPolicy,
  resolveCrossProjectPolicy,
} from '@modern-js/bff-core';
import type {
  APIServerStartInput,
  PrepareWebServerFn,
  ServerConfig,
  ServerPlugin,
  WebServerStartInput,
} from '@modern-js/server-core';
import { fs } from '@modern-js/utils';
import type { IncomingMessage, ServerResponse } from 'http';
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
 * Node-style request handler produced by `prepareApiServer`. The pipeline's
 * declared return type is a Hono middleware, but this adapter (and its test
 * harness) still exchange the legacy node `(req, res)` shape, so the tap is
 * registered through the same `as unknown as` seam plugin-bff uses.
 */
type ApiServerHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

type PrepareApiServerTap = (
  input: APIServerStartInput,
) => Promise<ApiServerHandler>;

/** `WebAdapter` is not re-exported from the server-core root entry. */
type WebAdapter = NonNullable<Awaited<ReturnType<PrepareWebServerFn>>>;

type PrepareWebServerTap = (
  input: WebServerStartInput,
  next: () => void,
) => WebAdapter | void;

/**
 * The adapters still consume the legacy v2 node render signature
 * `(req, res) => html`. Only reachable when `bff.enableHandleWeb` is set and
 * the caller provides a render function.
 */
type LegacyNodeRender = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<string | undefined>;

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
  setup: api => {
    const prepareApiServer: PrepareApiServerTap = async ({
      pwd,
      config,
      render,
    }) => {
      let app: Application;
      const router = new Router();
      const apiDir = path.join(pwd, './api');
      const appContext = api.getServerContext();
      const apiHandlerInfos = appContext.apiHandlerInfos as APIHandlerInfo[];
      const mode = appContext.apiMode;
      const userConfig: ServerConfig = api.getServerConfig();
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
        const legacyRender = render as unknown as LegacyNodeRender;
        app.use(async (ctx, next) => {
          const html = await legacyRender(ctx.req, ctx.res);
          if (html) {
            ctx.body = html;
          }
          await next();
        });
      }

      return (req, res) => Promise.resolve(app.callback()(req, res));
    };

    const prepareWebServer: PrepareWebServerTap = ({ config }, next) => {
      const userConfig: ServerConfig = api.getServerConfig();
      // `server.enableFrameworkExt` is a legacy v2 flag that no longer exists
      // on `ServerUserConfig`; keep honoring it when present at runtime.
      const serverConfig = userConfig?.server as
        | { enableFrameworkExt?: boolean }
        | undefined;
      if (!serverConfig?.enableFrameworkExt) {
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
    };

    api.prepareApiServer(
      prepareApiServer as unknown as Parameters<typeof api.prepareApiServer>[0],
    );
    api.prepareWebServer(
      prepareWebServer as unknown as Parameters<typeof api.prepareWebServer>[0],
    );
  },
});

// @effect-diagnostics asyncFunction:off newPromise:off nodeBuiltinImport:off strictBooleanExpressions:off

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
import { createDebugger, fs } from '@modern-js/utils';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import express, { type Express, type RequestHandler } from 'express';
import finalhandler from 'finalhandler';
import type { IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import { run } from './context';
import registerRoutes from './registerRoutes';

const debug = createDebugger('express');

interface FrameConfig {
  middleware: (RequestHandler | string)[];
}

type Hooks = {
  afterLambdaRegisted?: (app: Express) => void;
};

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
  const paths = exts.map(ext => path.resolve(apiDir, `app${ext}`));

  for (const filename of paths) {
    if (await fs.pathExists(filename)) {
      // 每次获取 app.ts 的时候，避免使用缓存的 app.ts
      delete require.cache[filename];
      return [requireWithInterop(filename), require(filename)];
    }
  }

  return [];
};

const initMiddlewares = (
  middleware: (RequestHandler | string)[],
  app: Express,
) => {
  middleware.forEach(middlewareItem => {
    const middlewareFunc =
      typeof middlewareItem === 'string'
        ? requireWithInterop(middlewareItem)
        : middlewareItem;
    app.use(middlewareFunc);
  });
};

const useRun = (app: Express) => {
  app.use((req, res, next) => {
    run({ req, res }, next);
  });
};

const initApp = (app: express.Express) => {
  app.use(cookieParser());
  app.use(express.text());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  return app;
};

const applyCrossProjectPolicy = (
  app: Express,
  crossProjectPolicy: CrossProjectPolicyConfig | undefined,
) => {
  if (!crossProjectPolicy?.enabled) {
    return;
  }

  app.use((req, res, next) => {
    const denial = checkCrossProjectPolicy(req.headers, crossProjectPolicy);
    if (!denial) {
      next();
      return;
    }

    res.status(denial.status).json(denial.body);
  });
};

export default (): ServerPlugin => ({
  name: '@modern-js/plugin-express',
  pre: ['@modern-js/plugin-bff'],
  post: ['@modern-js/plugin-server'],
  setup: api => {
    const prepareApiServer: PrepareApiServerTap = async ({
      pwd,
      config,
      render,
    }) => {
      let app: Express;
      const appContext = api.getServerContext();
      const apiHandlerInfos = appContext.apiHandlerInfos as APIHandlerInfo[];
      const apiDirectory = appContext.apiDirectory as string;
      const apiDir = apiDirectory || path.join(pwd, './api');
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
        const appModule = await findAppModule(apiDir);
        app = appModule[0];
        const hooks: Hooks = appModule[1];

        if (!app?.use) {
          // console.warn('There is not api/app.ts.');
          app = express();
        }
        initApp(app);
        applyCrossProjectPolicy(app, crossProjectPolicy);

        if (config) {
          const { middleware } = config as FrameConfig;
          initMiddlewares(middleware, app);
        }
        useRun(app);

        registerRoutes(app, apiHandlerInfos);
        if (hooks) {
          const { afterLambdaRegisted } = hooks;
          if (afterLambdaRegisted) {
            afterLambdaRegisted(app);
          }
        }
      } else if (mode === 'function') {
        app = express();
        initApp(app);
        applyCrossProjectPolicy(app, crossProjectPolicy);

        if (config) {
          const { middleware } = config as FrameConfig;
          initMiddlewares(middleware, app);
        }

        useRun(app);

        registerRoutes(app, apiHandlerInfos);
      } else {
        throw new Error(`mode must be function or framework`);
      }

      if (userConfig.bff?.enableHandleWeb && render) {
        const legacyRender = render as unknown as LegacyNodeRender;
        app.use(async (req, res, next) => {
          const html = await legacyRender(req, res);
          if (html) {
            res.end(html);
          }
          next();
        });
      }

      return (req, res) =>
        new Promise<void>((resolve, reject) => {
          const handler = (err: unknown) => {
            if (err) {
              return reject(err);
            }
            // finalhanlder will trigger 'finish' event
            return finalhandler(req, res, {})(null);
            // return resolve();
          };

          res.on('finish', (err: Error) => {
            if (err) {
              return reject(err);
            }
            return resolve();
          });
          return app(req as Request, res as Response, handler);
        });
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

      const app = express();
      initApp(app);
      if (config) {
        const { middleware } = config as FrameConfig;
        debug('web middleware', middleware);
        initMiddlewares(middleware, app);
      }

      return ctx =>
        new Promise<void>((resolve, reject) => {
          const { source } = ctx;
          const req = source.req as Request;
          const res = source.res as Response;
          const handler = (err: string) => {
            if (err) {
              return reject(err);
            }
            if (res.headersSent && res.statusCode !== 200) {
              finalhandler(req, res, {})(null);
            }
            return resolve();
          };

          // when user call res.send
          res.on('finish', (err: Error) => {
            if (err) {
              return reject(err);
            }
            return resolve();
          });
          return app(req, res, handler);
        });
    };

    api.prepareApiServer(
      prepareApiServer as unknown as Parameters<typeof api.prepareApiServer>[0],
    );
    api.prepareWebServer(
      prepareWebServer as unknown as Parameters<typeof api.prepareWebServer>[0],
    );
  },
});

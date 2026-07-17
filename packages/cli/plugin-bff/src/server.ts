// @effect-diagnostics asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import { ApiRouter } from '@modern-js/bff-core';
import type {
  APIServerStartInput,
  BffUserConfig,
  MiddlewareHandler,
  ServerPlugin,
  ServerPluginAPI,
} from '@modern-js/server-core';
import type { ServerNodeMiddleware } from '@modern-js/server-core/node';
import { API_DIR, isFunction, isWebOnly } from '@modern-js/utils';
import path from 'path';
import { EffectAdapter } from './runtime/effect/adapter';
import { HonoAdapter } from './runtime/hono/adapter';

type ApiMiddlewareRegistration = unknown;
type RuntimeFramework = NonNullable<BffUserConfig['runtimeFramework']>;

type RuntimeAdapterOptions = {
  prefix: string;
  enableHandleWeb?: boolean;
};

type RuntimeAdapter = {
  registerMiddleware: (options: RuntimeAdapterOptions) => Promise<void>;
};

type RuntimeAdapterFactory = (api: ServerPluginAPI) => RuntimeAdapter;

const RUNTIME_ADAPTER_FACTORIES: Record<
  RuntimeFramework,
  RuntimeAdapterFactory[]
> = {
  hono: [api => new HonoAdapter(api)],
  effect: [api => new EffectAdapter(api)],
};

const normalizePrefixList = (prefix: string | string[] | undefined) => {
  if (Array.isArray(prefix)) {
    return prefix.filter(Boolean);
  }
  return [prefix || '/api'];
};

const getPrimaryPrefix = (prefix: string | string[] | undefined) =>
  normalizePrefixList(prefix)[0] || '/api';

function resolveRuntimeFramework(
  runtimeFramework: BffUserConfig['runtimeFramework'],
): RuntimeFramework {
  return runtimeFramework === 'hono' ? 'hono' : 'effect';
}

type PrepareApiServerNext = (
  input: APIServerStartInput,
) => Promise<ServerNodeMiddleware>;
type PrepareApiServerTap = (
  input: APIServerStartInput,
  next: PrepareApiServerNext,
) => Promise<ServerNodeMiddleware>;

class Storage {
  public middlewares: ApiMiddlewareRegistration[] = [];
}

export default (): ServerPlugin => ({
  name: '@modern-js/plugin-bff',
  setup: api => {
    const storage = new Storage();
    let apiRouter: ApiRouter | null = null;

    const appContext = api.getServerContext();
    const runtimeFramework = resolveRuntimeFramework(
      appContext.bffRuntimeFramework,
    );
    const runtimeAdapters = RUNTIME_ADAPTER_FACTORIES[runtimeFramework].map(
      createAdapter => createAdapter(api),
    );

    api.onPrepare(async () => {
      const appContext = api.getServerContext();
      const { render } = appContext;

      const { middlewares } = storage;
      api.updateServerContext({
        ...appContext,
        apiMiddlewares: middlewares,
      });

      /** bind api server */
      const config = api.getServerConfig();
      const prefixList = normalizePrefixList(config?.bff?.prefix);
      const prefix = getPrimaryPrefix(config?.bff?.prefix);
      const enableHandleWeb = config?.bff?.enableHandleWeb;
      const httpMethodDecider = config?.bff?.httpMethodDecider;

      const { distDirectory: pwd, middlewares: globalMiddlewares } =
        api.getServerContext();

      const webOnly = await isWebOnly();

      if (runtimeFramework === 'hono') {
        let handler: ServerNodeMiddleware;

        if (webOnly) {
          handler = async (c, next) => {
            c.body('');
            await next();
          };
        } else {
          const runner = api.getHooks();
          const renderHandler = enableHandleWeb ? render : null;
          handler = await runner.prepareApiServer.call({
            pwd: pwd!,
            prefix,
            render: renderHandler,
            httpMethodDecider,
          });
        }

        if (handler && isFunction(handler)) {
          globalMiddlewares.push({
            name: 'bind-bff',
            handler: ((c, next) => {
              if (
                !prefixList.some(item => c.req.path.startsWith(item)) &&
                !enableHandleWeb
              ) {
                return next();
              }
              return handler(c, next);
            }) as MiddlewareHandler,
            order: 'post',
            before: [
              'custom-server-hook',
              'custom-server-middleware',
              'render',
            ],
          });
        }
      }

      await Promise.all(
        runtimeAdapters.map(adapter =>
          adapter.registerMiddleware({
            prefix,
            enableHandleWeb,
          }),
        ),
      );
    });
    // This plugin's own routes are re-registered from scratch on every unified
    // runtime reload, so no BFF-local route rebuild is needed here. But the
    // public `file-change` onReset signal is emitted on the LIVE runtime BEFORE
    // that debounced rebuild runs, and downstream server plugins may re-register
    // their BFF handlers from `appContext.apiHandlerInfos` inside their own
    // onReset handler. So we refresh apiHandlerInfos into the server context on
    // file-change, keeping the contract that this value is fresh when onReset
    // fires — otherwise those consumers would re-register with stale handlers.
    api.onReset(async ({ event }) => {
      if (event.type === 'file-change' && apiRouter) {
        const appContext = api.getServerContext();
        const apiHandlerInfos = await apiRouter.getApiHandlers();
        api.updateServerContext({
          ...appContext,
          apiHandlerInfos,
        });
      }
    });
    const prepareApiServer: PrepareApiServerTap = async (input, next) => {
      if (runtimeFramework !== 'hono') {
        return next(input);
      }
      const { pwd, prefix, httpMethodDecider } = input;
      const defaultApiDirectory = path.resolve(pwd, API_DIR);
      const appContext = api.getServerContext();
      const apiDirectory =
        typeof appContext.apiDirectory === 'string'
          ? appContext.apiDirectory
          : defaultApiDirectory;
      const lambdaDirectory =
        typeof appContext.lambdaDirectory === 'string'
          ? appContext.lambdaDirectory
          : undefined;

      apiRouter = new ApiRouter({
        appDir: pwd,
        apiDir: apiDirectory,
        lambdaDir: lambdaDirectory,
        prefix,
        httpMethodDecider,
      });
      const apiHandlerInfos = await apiRouter.getApiHandlers();
      api.updateServerContext({
        ...appContext,
        apiRouter,
        apiHandlerInfos,
      });
      return next(input);
    };
    api.prepareApiServer(
      prepareApiServer as unknown as Parameters<typeof api.prepareApiServer>[0],
    );
  },
});

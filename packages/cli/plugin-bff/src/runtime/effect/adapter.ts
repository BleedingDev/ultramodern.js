import path from 'path';
import { type APIHandlerInfo, ApiRouter } from '@modern-js/bff-core';
import type {
  Context,
  MiddlewareHandler,
  Next,
  ServerMiddleware,
  ServerPluginAPI,
} from '@modern-js/server-core';
import { Hono, run } from '@modern-js/server-core';
import {
  fs,
  API_DIR,
  compatibleRequire,
  findExists,
  isProd,
  logger,
} from '@modern-js/utils';
import type * as ServiceMap from 'effect/ServiceMap';
import { HttpApi } from 'effect/unstable/httpapi';
import createHonoRoutes from '../../utils/createHonoRoutes';
import { createHttpApiHandler } from './index';
import type {
  EffectBffOpenApiConfig,
  EffectDataPlatformValidationOptions,
  EffectRuntimeLayer,
} from './index';

const before = ['custom-server-hook', 'custom-server-middleware', 'render'];

const JS_OR_TS_EXTS = [
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;

interface MiddlewareOptions {
  prefix: string;
  enableHandleWeb?: boolean;
}

type EffectRequestContext = {
  env: Record<string, unknown>;
  path: string;
  method: string;
};

type ContextWithJson = Context & {
  json?: (data: unknown, status?: number, headers?: HeadersInit) => Response;
};

type RequestHandler = (
  request: Request,
  context?: ServiceMap.ServiceMap<never> | EffectRequestContext,
) => Promise<Response> | Response;

type EffectApiModule = {
  api?: unknown;
  layer?: unknown;
  handler?: RequestHandler;
  createHandler?: EffectHandlerFactory;
  default?: unknown;
};

type EffectHandlerFactory = (options?: {
  openapi?: EffectBffOpenApiConfig;
  dataPlatform?: EffectDataPlatformValidationOptions;
}) => {
  handler: RequestHandler;
  dispose: () => Promise<void>;
};

type LoadedHandler = {
  handler: RequestHandler;
  dispose?: () => Promise<void>;
};

function normalizePrefix(prefix: string) {
  if (prefix === '/') {
    return '';
  }
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function removePrefixFromPath(pathname: string, prefix: string) {
  const normalized = normalizePrefix(prefix);
  if (
    !normalized ||
    (pathname !== normalized && !pathname.startsWith(`${normalized}/`))
  ) {
    return pathname;
  }
  const sliced = pathname.slice(normalized.length);
  return sliced.startsWith('/') ? sliced : `/${sliced}`;
}

function createRequestForMountedPrefix(req: Request, prefix: string) {
  const url = new URL(req.url);
  const nextPath = removePrefixFromPath(url.pathname, prefix);
  if (nextPath === url.pathname) {
    return req;
  }
  url.pathname = nextPath;
  return new Request(url, req);
}

function isRequestHandler(value: unknown): value is RequestHandler {
  return typeof value === 'function';
}

function maybeResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function includesRuntimeExports(value: Record<string, unknown>) {
  return (
    'api' in value ||
    'layer' in value ||
    'createHandler' in value ||
    'handler' in value
  );
}

function isHttpApiWithProps(value: unknown): value is HttpApi.AnyWithProps {
  return (
    HttpApi.isHttpApi(value) &&
    isRecord(value) &&
    typeof value.identifier === 'string' &&
    isRecord(value.groups)
  );
}

function isEffectApiDefinition(module: EffectApiModule): module is {
  api: HttpApi.AnyWithProps;
  layer: EffectRuntimeLayer;
  handler?: RequestHandler;
  createHandler?: EffectHandlerFactory;
  default?: unknown;
} {
  return isHttpApiWithProps(module.api) && module.layer !== undefined;
}

export class EffectAdapter {
  api: ServerPluginAPI;
  isEffect = true;
  effectMiddleware: ServerMiddleware | null = null;
  legacyApiServer: Hono | null = null;

  private handler: RequestHandler | null = null;
  private dispose: (() => Promise<void>) | null = null;

  constructor(api: ServerPluginAPI) {
    this.api = api;
  }

  registerMiddleware = async (options: MiddlewareOptions) => {
    const { prefix, enableHandleWeb } = options;
    const { bffRuntimeFramework, middlewares: globalMiddlewares } =
      this.api.getServerContext();

    if (bffRuntimeFramework !== 'effect') {
      this.isEffect = false;
      return;
    }

    await this.reloadHandler();
    await this.reloadLegacyApiRoutes();

    this.effectMiddleware = {
      name: 'effect-bff-handler',
      path: enableHandleWeb ? '*' : `${prefix}/*`,
      method: 'all',
      order: 'post',
      before,
      handler: async (c: Context, next: Next) => {
        if (!this.handler) {
          await this.handleLegacyApiRoute(c, next);
          return;
        }

        let response: Response;
        try {
          const effectRequest = createRequestForMountedPrefix(
            c.req.raw,
            prefix,
          );
          const maybeContext = {
            env: c.env as Record<string, unknown>,
            path: c.req.path,
            method: c.req.method,
          };
          response =
            this.handler.length > 1
              ? await this.handler(effectRequest, maybeContext)
              : await this.handler(effectRequest);
        } catch (error) {
          return this.handleRuntimeError(error, c);
        }

        if (!maybeResponse(response)) {
          await this.handleLegacyApiRoute(c, next);
          return;
        }

        if (response.status === 404 && !enableHandleWeb) {
          await this.handleLegacyApiRoute(c, next);
          return;
        }

        return new Response(response.body, response);
      },
    };

    globalMiddlewares.push(this.effectMiddleware);
  };

  onApiHandlersUpdated = async () => {
    if (!this.isEffect || isProd()) {
      return;
    }
    await Promise.all([this.reloadHandler(), this.reloadLegacyApiRoutes()]);
  };

  private async handleLegacyApiRoute(c: Context, next: Next) {
    if (this.legacyApiServer) {
      const response = await this.legacyApiServer.fetch(c.req.raw, c.env);
      if (response.status !== 404) {
        c.res = response;
        return;
      }
    }
    await next();
  }

  private async reloadLegacyApiRoutes() {
    const apiHandlerInfos = await this.resolveApiHandlerInfos();
    this.legacyApiServer = new Hono();
    this.legacyApiServer.use('*', run);

    const honoHandlers = createHonoRoutes(apiHandlerInfos);
    for (const { path: routePath, method, handler } of honoHandlers) {
      const handlers = this.wrapInArray(handler);
      if (handlers.length === 0) {
        continue;
      }
      const firstHandler = handlers[0]!;
      const restHandlers = handlers.slice(1);
      type RouteMethod =
        | 'options'
        | 'get'
        | 'post'
        | 'put'
        | 'delete'
        | 'patch'
        | 'all';
      type Register = (
        routePath: string,
        handler: MiddlewareHandler,
        ...handlers: MiddlewareHandler[]
      ) => unknown;
      const routeMethod = method as RouteMethod;
      const register = this.legacyApiServer[routeMethod] as unknown as Register;
      register.call(
        this.legacyApiServer,
        routePath,
        firstHandler,
        ...restHandlers,
      );
    }

    this.legacyApiServer.onError((error, c) => {
      return this.handleRuntimeError(error, c);
    });
  }

  private async resolveApiHandlerInfos(): Promise<APIHandlerInfo[]> {
    const appContext = this.api.getServerContext();
    if (
      Array.isArray(appContext.apiHandlerInfos) &&
      appContext.apiHandlerInfos.length > 0
    ) {
      return appContext.apiHandlerInfos as APIHandlerInfo[];
    }

    const bffConfig = this.api.getServerConfig()?.bff;
    const appDir =
      appContext.distDirectory || appContext.appDirectory || process.cwd();
    const apiDir =
      typeof appContext.apiDirectory === 'string'
        ? appContext.apiDirectory
        : path.resolve(appDir, API_DIR);
    const lambdaDir =
      typeof appContext.lambdaDirectory === 'string'
        ? appContext.lambdaDirectory
        : undefined;

    const apiRouter = new ApiRouter({
      appDir,
      apiDir,
      lambdaDir,
      prefix: bffConfig?.prefix || '/api',
      httpMethodDecider: bffConfig?.httpMethodDecider,
    });
    return (await apiRouter.getApiHandlers()) as APIHandlerInfo[];
  }

  private wrapInArray(
    handler: MiddlewareHandler[] | MiddlewareHandler,
  ): MiddlewareHandler[] {
    if (Array.isArray(handler)) {
      return handler;
    }
    return [handler];
  }

  private resolveEntryFile() {
    const { appDirectory, apiDirectory } = this.api.getServerContext();
    const bffConfig = this.api.getServerConfig()?.bff;
    const configuredEntry = bffConfig?.effect?.entry;
    const defaultEntry = path.resolve(
      appDirectory || process.cwd(),
      apiDirectory || '',
      'effect',
      'index',
    );

    const entryWithoutExt = configuredEntry
      ? path.isAbsolute(configuredEntry)
        ? configuredEntry
        : path.resolve(appDirectory || process.cwd(), configuredEntry)
      : defaultEntry;

    return findExists(JS_OR_TS_EXTS.map(ext => `${entryWithoutExt}${ext}`));
  }

  private async loadEffectHandlerFromModule(
    mod: EffectApiModule,
  ): Promise<LoadedHandler | null> {
    let normalizedModule = mod;
    const mergeRuntimeExports = (value: unknown) => {
      if (!isRecord(value) || !includesRuntimeExports(value)) {
        return;
      }
      normalizedModule = {
        ...normalizedModule,
        ...value,
      };
    };

    if (isRequestHandler(normalizedModule.handler)) {
      return {
        handler: normalizedModule.handler,
      };
    }

    const entry = normalizedModule.default;
    if (isRequestHandler(entry)) {
      return {
        handler: entry,
      };
    }

    if (typeof entry === 'function' && entry.length === 0) {
      const out = await entry();
      if (isRequestHandler(out)) {
        return {
          handler: out,
        };
      }
      mergeRuntimeExports(out);
    }

    if (isRecord(entry)) {
      normalizedModule = {
        ...normalizedModule,
        ...entry,
      };
    }

    if (isRecord(entry) && 'handler' in entry) {
      const maybeHandler = entry.handler;
      if (isRequestHandler(maybeHandler)) {
        normalizedModule = {
          ...normalizedModule,
          handler: maybeHandler,
        };
      }
    }

    if (typeof normalizedModule.createHandler === 'function') {
      const webHandler = normalizedModule.createHandler({
        openapi: this.api.getServerConfig()?.bff?.effect?.openapi,
        dataPlatform: this.api.getServerConfig()?.bff?.effect?.dataPlatform,
      });
      return {
        handler: async request => webHandler.handler(request),
        dispose: async () => {
          await webHandler.dispose();
        },
      };
    }

    if (isEffectApiDefinition(normalizedModule)) {
      logger.warn(
        '[BFF][Effect] Detected { api, layer } export without createHandler. Prefer `defineEffectBff(...)` from @modern-js/plugin-bff/effect-server to avoid module instance mismatch.',
      );
      const webHandler = createHttpApiHandler({
        api: normalizedModule.api,
        layer: normalizedModule.layer,
        openapi: this.api.getServerConfig()?.bff?.effect?.openapi,
        dataPlatform: this.api.getServerConfig()?.bff?.effect?.dataPlatform,
      });
      return {
        handler: async request => webHandler.handler(request),
        dispose: async () => {
          await webHandler.dispose();
        },
      };
    }

    return null;
  }

  private async reloadHandler() {
    if (!this.isEffect) {
      return;
    }

    const entryFile = this.resolveEntryFile();
    if (!entryFile) {
      await this.disposeCurrentHandler();
      this.handler = null;
      return;
    }

    if (!(await fs.pathExists(entryFile))) {
      await this.disposeCurrentHandler();
      this.handler = null;
      return;
    }

    await this.disposeCurrentHandler();

    const resolvedEntryFile = require.resolve(entryFile);
    if (Object.hasOwn(require.cache, resolvedEntryFile)) {
      delete require.cache[resolvedEntryFile];
    }

    let mod: EffectApiModule;
    try {
      mod = (await compatibleRequire(entryFile, false)) as EffectApiModule;
    } catch (error) {
      logger.error(
        `[BFF][Effect] Failed to load Effect entry: ${entryFile}\n${String(error)}`,
      );
      this.handler = null;
      return;
    }

    const loaded = await this.loadEffectHandlerFromModule(mod);

    if (!loaded) {
      logger.warn(
        `[BFF][Effect] Invalid Effect entry module: ${entryFile}. Export { api, layer } or handler.`,
      );
      this.handler = null;
      return;
    }

    this.handler = loaded.handler;
    this.dispose = loaded.dispose || null;
  }

  private async disposeCurrentHandler() {
    if (!this.dispose) {
      return;
    }

    try {
      await this.dispose();
    } catch (error) {
      logger.warn(
        `[BFF][Effect] Failed to dispose previous handler: ${String(error)}`,
      );
    } finally {
      this.dispose = null;
    }
  }

  private async handleRuntimeError(error: unknown, c: Context) {
    try {
      const serverConfig = this.api.getServerConfig();
      const onErrorHandler = serverConfig?.onError;
      if (onErrorHandler) {
        const onErrorContext = this.ensureJsonContext(c);
        const result = await onErrorHandler(
          error instanceof Error ? error : new Error(String(error)),
          onErrorContext,
        );
        if (result instanceof Response) {
          return result;
        }
      } else {
        logger.error(error);
      }
    } catch (configError) {
      logger.error(`Error in serverConfig.onError handler: ${configError}`);
    }

    const status =
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
        ? error.status
        : 500;

    return new Response(
      JSON.stringify({
        message:
          error instanceof Error
            ? error.message
            : '[BFF] Internal Server Error',
      }),
      {
        status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      },
    );
  }

  private ensureJsonContext(c: Context): Context {
    const maybeJsonContext = c as ContextWithJson;
    if (typeof maybeJsonContext.json === 'function') {
      return c;
    }

    const headers = {
      'content-type': 'application/json; charset=utf-8',
    };
    const withJson = Object.assign({}, c, {
      json: (data: unknown, status = 200, extraHeaders?: HeadersInit) => {
        const responseHeaders = new Headers(headers);
        if (extraHeaders) {
          new Headers(extraHeaders).forEach((value, key) => {
            responseHeaders.set(key, value);
          });
        }
        return new Response(JSON.stringify(data), {
          status,
          headers: responseHeaders,
        });
      },
    });

    return withJson as Context;
  }
}

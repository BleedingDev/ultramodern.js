// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import type {
  Context,
  Next,
  ServerMiddleware,
  ServerPluginAPI,
} from '@modern-js/server-core';
import {
  API_DIR,
  compatibleRequire,
  findExists,
  fs,
  isProd,
  logger,
} from '@modern-js/utils';
import path from 'path';
import {
  createEffectOperationContext,
  type EffectContext,
  runWithEffectContext,
} from './context';
import {
  type EffectApiModule,
  type EffectBffRequestHandler,
  resolveEffectBffModuleHandler,
} from './module';

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

type ContextWithJson = Context & {
  json?: (data: unknown, status?: number, headers?: HeadersInit) => Response;
};

type RequestHandler = EffectBffRequestHandler;

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

function maybeResponse(value: unknown): value is Response {
  return value instanceof Response;
}

export class EffectAdapter {
  api: ServerPluginAPI;
  isEffect = true;
  effectMiddleware: ServerMiddleware | null = null;

  private handler: RequestHandler | null = null;
  private dispose: (() => Promise<void>) | null = null;

  constructor(api: ServerPluginAPI) {
    this.api = api;
  }

  registerMiddleware = async (options: MiddlewareOptions) => {
    const { prefix, enableHandleWeb } = options;
    const { bffRuntimeFramework, middlewares: globalMiddlewares } =
      this.api.getServerContext();

    // Effect is the default runtime. Only skip when explicitly set to hono.
    if (bffRuntimeFramework === 'hono') {
      this.isEffect = false;
      return;
    }

    await this.reloadHandler();

    this.effectMiddleware = {
      name: 'effect-bff-handler',
      path: enableHandleWeb ? '*' : `${prefix}/*`,
      method: 'all',
      order: 'post',
      before,
      handler: async (c: Context, next: Next) => {
        if (!this.handler) {
          if (enableHandleWeb) {
            await next();
            return;
          }
          return this.handleRuntimeError(
            new Error(
              '[BFF][Effect] Missing Effect entry. Define api/effect/index or configure bff.effect.entry.',
            ),
            c,
          );
        }

        let response: Response;
        try {
          const effectRequest = createRequestForMountedPrefix(
            c.req.raw,
            prefix,
          );
          const effectContext: EffectContext = {
            request: effectRequest,
            env: c.env as Record<string, unknown>,
            path: c.req.path,
            method: c.req.method,
            operationContext: createEffectOperationContext({
              request: effectRequest,
              env: c.env as Record<string, unknown>,
              path: c.req.path,
              method: c.req.method,
            }),
          };
          response = await runWithEffectContext(effectContext, () =>
            this.handler!.length > 1
              ? this.handler!(effectRequest, effectContext)
              : this.handler!(effectRequest),
          );
        } catch (error) {
          return this.handleRuntimeError(error, c);
        }

        if (!maybeResponse(response)) {
          return this.handleRuntimeError(
            new Error(
              '[BFF][Effect] Effect handler must return a Response instance.',
            ),
            c,
          );
        }

        if (response.status === 404 && enableHandleWeb) {
          await next();
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
    await this.reloadHandler();
  };

  private resolveEntryFile() {
    const { appDirectory, apiDirectory } = this.api.getServerContext();
    const bffConfig = this.api.getServerConfig()?.bff;
    const configuredEntry = bffConfig?.effect?.entry;
    const defaultEntry = path.resolve(
      appDirectory || process.cwd(),
      apiDirectory || API_DIR,
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

  private async loadEffectHandlerFromModule(mod: EffectApiModule) {
    return resolveEffectBffModuleHandler(mod, {
      openapi: this.api.getServerConfig()?.bff?.effect?.openapi,
      dataPlatform: this.api.getServerConfig()?.bff?.effect?.dataPlatform,
      onWarning: message => {
        logger.warn(message);
      },
    });
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

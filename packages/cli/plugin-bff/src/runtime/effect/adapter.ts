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
import { HttpApi } from 'effect/unstable/httpapi';
import path from 'path';
import {
  checkCrossProjectPolicyForRequest,
  type ResolvedCrossProjectPolicy,
  resolveAdapterCrossProjectPolicy,
} from '../../utils/crossProjectServerPolicy';
import { createSafeFailureResponse } from '../safe-failure';
import { runWithEffectContext } from './context';
import { dispatchEffectBffRequestWithContext } from './dispatch';
import {
  collectEffectEndpoints,
  extractHttpApiFromModule,
  toOperationContractSources,
} from './endpoint-contracts';
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

type JsOrTsExtension = (typeof JS_OR_TS_EXTS)[number];

function resolveJsOrTsEntry(entryWithoutOrWithExt: string) {
  const extension = path.extname(entryWithoutOrWithExt) as JsOrTsExtension;
  if (JS_OR_TS_EXTS.includes(extension)) {
    return fs.existsSync(entryWithoutOrWithExt)
      ? entryWithoutOrWithExt
      : undefined;
  }

  return findExists(JS_OR_TS_EXTS.map(ext => `${entryWithoutOrWithExt}${ext}`));
}

interface MiddlewareOptions {
  prefix: string;
  enableHandleWeb?: boolean;
}

type ContextWithJson = Context & {
  json?: (data: unknown, status?: number, headers?: HeadersInit) => Response;
};

type RequestHandler = EffectBffRequestHandler;

export class EffectAdapter {
  api: ServerPluginAPI;
  isEffect = true;
  effectMiddleware: ServerMiddleware | null = null;
  crossProjectPolicy: ResolvedCrossProjectPolicy | undefined;

  private handler: RequestHandler | null = null;
  private dispose: (() => Promise<void>) | null = null;
  private prefix = '/api';

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

    this.prefix = prefix || this.prefix;

    await this.reloadHandler();

    this.effectMiddleware = {
      name: 'effect-api-handler',
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
              '[BFF][Effect] Missing Effect entry. Define api/index or configure bff.effect.entry.',
            ),
            c,
          );
        }

        const response = await dispatchEffectBffRequestWithContext(
          this.handler,
          c.req.raw,
          {
            prefix,
            env: c.env as Record<string, unknown>,
            path: c.req.path,
            method: c.req.method,
            runWithEffectContext,
            onError: error => this.handleRuntimeError(error, c),
          },
        );

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

    if (configuredEntry) {
      const entryWithoutExt = path.isAbsolute(configuredEntry)
        ? configuredEntry
        : path.resolve(appDirectory || process.cwd(), configuredEntry);
      return resolveJsOrTsEntry(entryWithoutExt);
    }

    const apiRoot = path.resolve(
      appDirectory || process.cwd(),
      apiDirectory || API_DIR,
    );

    return resolveJsOrTsEntry(path.resolve(apiRoot, 'index'));
  }

  /**
   * Resolves the cross-project policy from the reflected HttpApi endpoints so
   * the expected operation contracts match the hashes the client generators
   * stamp into generated SDKs.
   */
  private async refreshCrossProjectPolicy(mod: EffectApiModule | null) {
    let contractSources: ReturnType<typeof toOperationContractSources> = [];
    if (mod) {
      try {
        const api = await extractHttpApiFromModule(mod, HttpApi.isHttpApi);
        if (api) {
          // Bridge the strongly-typed HttpApi.reflect onto the loose
          // reflection contract shared with the client generator.
          const reflect: Parameters<typeof collectEffectEndpoints>[0] = (
            apiValue,
            handlers,
          ) =>
            HttpApi.reflect(apiValue as Parameters<typeof HttpApi.reflect>[0], {
              onGroup: handlers.onGroup ?? (() => {}),
              onEndpoint: handlers.onEndpoint,
            });
          contractSources = toOperationContractSources(
            collectEffectEndpoints(reflect, api, this.prefix),
          );
        }
      } catch (error) {
        logger.warn(
          `[BFF][Effect] Failed to reflect HttpApi endpoints for the cross-project policy: ${String(error)}`,
        );
      }
    }

    const policy = resolveAdapterCrossProjectPolicy(this.api, contractSources);
    this.crossProjectPolicy = policy;
    if (this.crossProjectPolicy?.enabled && contractSources.length === 0) {
      logger.warn(
        '[BFF][Effect] Cross-project policy is enabled but no HttpApi endpoints could be reflected; operation-contract matching is disabled for this server (envelope and operation-context checks still apply).',
      );
    }
  }

  private async loadEffectHandlerFromModule(mod: EffectApiModule) {
    const effectConfig = this.api.getServerConfig()?.bff?.effect;
    return resolveEffectBffModuleHandler(mod, {
      openapi: effectConfig?.openapi,
      dataPlatform: effectConfig?.dataPlatform,
      validateRequest: request =>
        checkCrossProjectPolicyForRequest(request, this.crossProjectPolicy),
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

    await this.refreshCrossProjectPolicy(mod);

    const loaded = await this.loadEffectHandlerFromModule(mod);

    if (!loaded) {
      logger.warn(
        `[BFF][Effect] Invalid Effect entry module: ${entryFile}. Export defineEffectBff(...) or a { api, layer } HttpApi module.`,
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

    return createSafeFailureResponse(error);
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

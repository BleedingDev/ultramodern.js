// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import { ApiRouter, type OperationContractSource } from '@modern-js/bff-core';
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
import {
  createEffectOperationContext,
  type EffectContext,
  runWithEffectContext,
} from './context';
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
  crossProjectPolicy: ResolvedCrossProjectPolicy | undefined;

  private handler: RequestHandler | null = null;
  private dispose: (() => Promise<void>) | null = null;
  private prefix = '/api';
  /**
   * True when the loaded handler does NOT run the policy seam internally
   * (plain `handler` exports); the adapter middleware enforces it instead.
   */
  private policyEnforcedInMiddleware = false;

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

        if (
          this.crossProjectPolicy?.enabled &&
          this.policyEnforcedInMiddleware &&
          this.isApiRequestPath(c.req.path, prefix, enableHandleWeb)
        ) {
          // Plain `handler` exports bypass the createHttpApiHandler policy
          // seam, so the adapter enforces the cross-project policy here.
          const denial = checkCrossProjectPolicyForRequest(
            c.req.raw,
            this.crossProjectPolicy,
          );
          if (denial) {
            return denial;
          }
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

  private isApiRequestPath(
    requestPath: string,
    prefix: string,
    enableHandleWeb: boolean | undefined,
  ) {
    if (!enableHandleWeb) {
      // Middleware path is already scoped to `${prefix}/*`.
      return true;
    }
    const normalized = normalizePrefix(prefix);
    if (!normalized) {
      return true;
    }
    return (
      requestPath === normalized || requestPath.startsWith(`${normalized}/`)
    );
  }

  /**
   * Contract sources for the lambda-lane handlers hosted alongside the
   * effect entry. Cross-project SDKs generate per-operation contracts for
   * `api/lambda` handlers with the exact same `ApiRouter` derivation used
   * here, so the server-side expected-contract map must include them —
   * otherwise every lambda-lane operation of a hosted producer SDK would be
   * denied as `unknown_operation_contract`.
   */
  private async collectLambdaContractSources(): Promise<
    OperationContractSource[]
  > {
    try {
      const serverContext = this.api.getServerContext() as {
        distDirectory?: string;
        appDirectory?: string;
        apiDirectory?: string;
        lambdaDirectory?: string;
      };
      const appDir = serverContext.distDirectory || serverContext.appDirectory;
      if (!appDir) {
        return [];
      }
      const apiDir =
        typeof serverContext.apiDirectory === 'string'
          ? serverContext.apiDirectory
          : path.resolve(appDir, API_DIR);
      // Only framework-mode lambda layouts apply in the effect lane: without
      // an actual lambda directory ApiRouter would fall back to function
      // mode and misread the effect entry itself as lambda handlers.
      const lambdaDir =
        typeof serverContext.lambdaDirectory === 'string'
          ? serverContext.lambdaDirectory
          : path.join(apiDir, 'lambda');
      if (!(await fs.pathExists(lambdaDir))) {
        return [];
      }

      const apiRouter = new ApiRouter({
        appDir,
        apiDir,
        lambdaDir,
        prefix: this.prefix,
        httpMethodDecider: this.api.getServerConfig()?.bff?.httpMethodDecider,
      });
      const handlerInfos = await apiRouter.getApiHandlers();
      return handlerInfos.map(info => ({
        name: info.name,
        httpMethod: info.httpMethod,
        routePath: info.routePath,
        filename: info.filename,
        handler: info.handler,
      }));
    } catch (error) {
      logger.warn(
        `[BFF][Effect] Failed to derive lambda operation contracts for the cross-project policy: ${String(error)}`,
      );
      return [];
    }
  }

  /**
   * Resolves the cross-project policy from the reflected HttpApi endpoints
   * (plus any hosted lambda-lane handlers) so the expected operation
   * contracts match the hashes the client generators stamp into generated
   * SDKs.
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

    let policy = resolveAdapterCrossProjectPolicy(this.api, contractSources);
    if (policy?.enabled) {
      // Only walk the lambda handlers when the policy actually applies:
      // loading them is wasted work (and a potential module side effect)
      // for servers that never evaluate the policy.
      const lambdaSources = await this.collectLambdaContractSources();
      if (lambdaSources.length > 0) {
        contractSources = [...contractSources, ...lambdaSources];
        policy = resolveAdapterCrossProjectPolicy(this.api, contractSources);
      }
    }
    this.crossProjectPolicy = policy;
    if (this.crossProjectPolicy?.enabled && contractSources.length === 0) {
      logger.warn(
        '[BFF][Effect] Cross-project policy is enabled but no HttpApi endpoints could be reflected; operation-contract matching is disabled for this server (envelope and operation-context checks still apply).',
      );
    }
  }

  private async loadEffectHandlerFromModule(mod: EffectApiModule) {
    return resolveEffectBffModuleHandler(mod, {
      openapi: this.api.getServerConfig()?.bff?.effect?.openapi,
      dataPlatform: this.api.getServerConfig()?.bff?.effect?.dataPlatform,
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
        `[BFF][Effect] Invalid Effect entry module: ${entryFile}. Export { api, layer } or handler.`,
      );
      this.handler = null;
      return;
    }

    this.handler = loaded.handler;
    this.dispose = loaded.dispose || null;
    this.policyEnforcedInMiddleware = !loaded.appliesRequestValidator;
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

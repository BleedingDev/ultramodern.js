// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off

import path from 'node:path';
import {
  dispatchEffectBffRequest,
  type EffectApiModule,
  type EffectBffRequestHandler,
  resolveEffectBffModuleHandler,
  useEffectContext,
} from '@modern-js/bff-effect/effect';
import type { Context, Next, ServerPluginAPI } from '@modern-js/server-core';
import {
  createDisposableServerRuntimeHandle,
  type DisposableServerRuntimeHandle,
  registerServerRuntimeDisposer,
} from '@modern-js/server-runtime-extensions/runtime-lifecycle';
import { fs, isProd, logger } from '@modern-js/utils';

import { checkCrossProjectPolicyForRequest } from '../cross-project-policy/evaluation';
import {
  loadEffectBuiltModule,
  loadEffectSourceModule,
} from '../effect-source-loader/loader';
import { resolveEffectAdapterCrossProjectPolicy } from './cross-project-policy';
import { resolveEffectAdapterEntryFile } from './entry';
import { createEffectAdapterRuntimeErrorResponse } from './error-response';

const EFFECT_MIDDLEWARE_BEFORE = [
  'custom-server-hook',
  'custom-server-middleware',
  'render',
];

interface EffectAdapterMiddlewareOptions {
  prefix: string | readonly string[];
  enableHandleWeb?: boolean;
}

export class EffectAdapter {
  private api: ServerPluginAPI;

  private handler: DisposableServerRuntimeHandle | null = null;
  private unregisterRuntimeDisposer?: () => void;
  private prefix = '/api';
  private prefixes = ['/api'];
  private matchingPrefixes = ['/api'];
  private retired = false;

  constructor(api: ServerPluginAPI) {
    this.api = api;
  }

  registerMiddleware = async (options: EffectAdapterMiddlewareOptions) => {
    const { enableHandleWeb } = options;
    const { bffRuntimeFramework, middlewares: globalMiddlewares } =
      this.api.getServerContext();

    if (bffRuntimeFramework === 'hono') {
      return;
    }

    const configuredPrefixes = Array.isArray(options.prefix)
      ? options.prefix.filter(Boolean)
      : [options.prefix || '/api'];
    this.prefixes = [
      ...new Set(configuredPrefixes.length > 0 ? configuredPrefixes : ['/api']),
    ];
    this.matchingPrefixes = [...this.prefixes].sort(
      (left, right) => right.length - left.length,
    );
    this.prefix = this.prefixes[0] || '/api';
    const { serverBase } = this.api.getServerContext() as {
      serverBase?: object;
    };
    if (serverBase) {
      this.unregisterRuntimeDisposer = registerServerRuntimeDisposer(
        serverBase,
        this.dispose,
      );
    }

    try {
      await this.loadHandler();
    } catch (error) {
      await this.dispose();
      throw error;
    }

    const middlewarePrefixes = enableHandleWeb
      ? [this.prefix]
      : this.matchingPrefixes;
    const middlewares = middlewarePrefixes.map(middlewarePrefix => ({
      name: 'effect-api-handler',
      path: enableHandleWeb ? '*' : `${middlewarePrefix}/*`,
      method: 'all' as const,
      order: 'post' as const,
      before: EFFECT_MIDDLEWARE_BEFORE,
      handler: async (context: Context, next: Next) => {
        const handler = this.handler;
        if (!handler) {
          if (enableHandleWeb) {
            await next();
            return;
          }
          return createEffectAdapterRuntimeErrorResponse(
            this.api,
            new Error(
              '[BFF][Effect] Missing Effect entry. Define api/index or configure bff.effect.entry.',
            ),
            context,
          );
        }

        const prefix = enableHandleWeb
          ? this.matchingPrefixes.find(
              item =>
                item === '/' ||
                context.req.path === item ||
                context.req.path.startsWith(`${item}/`),
            ) || this.prefix
          : middlewarePrefix;
        const response = await dispatchEffectBffRequest(
          handler as EffectBffRequestHandler,
          context.req.raw,
          {
            prefix,
            env: context.env as Record<string, unknown>,
            path: context.req.path,
            method: context.req.method,
            onError: error =>
              createEffectAdapterRuntimeErrorResponse(this.api, error, context),
          },
        );

        if (response.status === 404 && enableHandleWeb) {
          await next();
          return;
        }

        return new Response(response.body, response);
      },
    }));

    globalMiddlewares.push(...middlewares);
  };

  dispose = async () => {
    this.retired = true;
    this.unregisterRuntimeDisposer?.();
    this.unregisterRuntimeDisposer = undefined;
    const previous = this.handler;
    this.handler = null;
    await previous?.dispose();
  };

  private async loadHandler() {
    const entryFile = resolveEffectAdapterEntryFile(this.api);
    if (!entryFile || !(await fs.pathExists(entryFile))) {
      this.handler = null;
      return;
    }

    let mod: EffectApiModule;
    try {
      const { appDirectory } = this.api.getServerContext();
      mod = (await (isProd()
        ? loadEffectBuiltModule(entryFile)
        : loadEffectSourceModule({
            resourcePath: entryFile,
            appDir: appDirectory || path.dirname(entryFile),
          }))) as EffectApiModule;
    } catch (error) {
      logger.error(
        `[BFF][Effect] Failed to load Effect entry: ${entryFile}\n${String(error)}`,
      );
      throw error;
    }

    const crossProjectPolicies = new Map(
      await Promise.all(
        this.prefixes.map(
          async prefix =>
            [
              prefix,
              await resolveEffectAdapterCrossProjectPolicy(
                this.api,
                prefix,
                mod,
              ),
            ] as const,
        ),
      ),
    );
    const effectConfig = this.api.getServerConfig()?.bff?.effect;
    const loaded = await resolveEffectBffModuleHandler(mod, {
      openapi: effectConfig?.openapi,
      dataPlatform: effectConfig?.dataPlatform,
      validateRequest: request => {
        const { path: mountedPathname } = useEffectContext();
        const prefix = this.matchingPrefixes.find(
          item =>
            item === '/' ||
            mountedPathname === item ||
            mountedPathname.startsWith(`${item}/`),
        );
        if (!prefix) {
          return null;
        }
        const requestUrl = new URL(request.url);
        if (prefix !== '/') {
          requestUrl.pathname =
            requestUrl.pathname === '/'
              ? prefix
              : `${prefix}${requestUrl.pathname}`;
        }
        return checkCrossProjectPolicyForRequest(
          new Request(requestUrl, request),
          crossProjectPolicies.get(prefix),
        );
      },
      onWarning: message => logger.warn(message),
    });

    if (!loaded) {
      const error = new Error(
        `[BFF][Effect] Invalid Effect entry module: ${entryFile}. Export defineEffectBff(...) or a { api, layer } HttpApi module.`,
      );
      logger.warn(error.message);
      throw error;
    }

    const candidateOwner = {};
    if (loaded.dispose) {
      registerServerRuntimeDisposer(candidateOwner, loaded.dispose);
    }
    const candidate = createDisposableServerRuntimeHandle(
      candidateOwner,
      loaded.handler,
    );
    if (this.retired) {
      await candidate.dispose();
      throw new Error('Cannot initialize a retired Effect adapter.');
    }
    this.handler = candidate;
  }
}

// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import type {
  Context,
  Next,
  ServerMiddleware,
  ServerPluginAPI,
} from '@modern-js/server-core';
import { fs, isProd, logger } from '@modern-js/utils';
import path from 'path';

import type { ResolvedCrossProjectPolicy } from '../../utils/crossProjectServerPolicy';
import { loadEffectSourceModule } from '../../utils/effectSourceLoader';
import { before } from './adapter/constants';
import { resolveEffectAdapterCrossProjectPolicy } from './adapter/cross-project-policy';
import { resolveEffectAdapterEntryFile } from './adapter/entry';
import { createEffectAdapterRuntimeErrorResponse } from './adapter/error-response';
import { loadEffectAdapterHandlerFromModule } from './adapter/handler';
import { runWithEffectContext } from './context';
import { dispatchEffectBffRequestWithContext } from './dispatch';
import type { EffectApiModule, EffectBffRequestHandler } from './module';

interface MiddlewareOptions {
  prefix: string;
  enableHandleWeb?: boolean;
}

type RequestHandler = EffectBffRequestHandler;

export class EffectAdapter {
  private api: ServerPluginAPI;
  isEffect = true;
  effectMiddleware?: ServerMiddleware;
  crossProjectPolicy?: ResolvedCrossProjectPolicy;

  private handler: RequestHandler | null = null;
  private dispose: (() => void | Promise<void>) | null = null;
  private prefix = '/api';

  constructor(api: ServerPluginAPI) {
    this.api = api;
  }

  registerMiddleware = async (options: MiddlewareOptions) => {
    const { prefix, enableHandleWeb } = options;
    const { bffRuntimeFramework, middlewares: globalMiddlewares } =
      this.api.getServerContext();

    // Effect is default runtime. Only skip when explicitly set to hono.
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
          return createEffectAdapterRuntimeErrorResponse(
            this.api,
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
            onError: error =>
              createEffectAdapterRuntimeErrorResponse(this.api, error, c),
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
    return resolveEffectAdapterEntryFile(this.api);
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

    let mod: EffectApiModule;
    try {
      const { appDirectory } = this.api.getServerContext();
      mod = (await loadEffectSourceModule({
        resourcePath: entryFile,
        appDir: appDirectory || path.dirname(entryFile),
      })) as EffectApiModule;
    } catch (error) {
      logger.error(
        `[BFF][Effect] Failed to load Effect entry: ${entryFile}\n${String(error)}`,
      );
      this.handler = null;
      return;
    }

    this.crossProjectPolicy = await resolveEffectAdapterCrossProjectPolicy(
      this.api,
      this.prefix,
      mod,
    );

    const loaded = await loadEffectAdapterHandlerFromModule(
      this.api,
      mod,
      this.crossProjectPolicy,
    );

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
        `[BFF][Effect] Failed dispose previous handler: ${String(error)}`,
      );
    } finally {
      this.dispose = null;
    }
  }
}

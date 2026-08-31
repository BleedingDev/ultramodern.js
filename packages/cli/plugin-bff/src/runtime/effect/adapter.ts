// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off
import type {
  Context,
  Next,
  ServerMiddleware,
  ServerPluginAPI,
} from '@modern-js/server-core';
import {
  createDisposableServerRuntimeHandle,
  type DisposableServerRuntimeHandle,
  registerServerRuntimeDisposer,
} from '@modern-js/server-runtime-extensions/runtime-lifecycle';
import { fs, isProd, logger } from '@modern-js/utils';
import path from 'path';

import type { ResolvedCrossProjectPolicy } from '../../utils/crossProjectServerPolicy';
import {
  loadEffectBuiltModule,
  loadEffectSourceModule,
} from '../../utils/effectSourceLoader';
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

export class EffectAdapter {
  private api: ServerPluginAPI;
  isEffect = true;
  effectMiddleware?: ServerMiddleware;
  crossProjectPolicy?: ResolvedCrossProjectPolicy;

  private handler: DisposableServerRuntimeHandle | null = null;
  private unregisterRuntimeDisposer?: () => void;
  private prefix = '/api';
  private reloadGeneration = 0;
  private retired = false;

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
      await this.reloadHandler();
    } catch (error) {
      await this.dispose();
      throw error;
    }

    this.effectMiddleware = {
      name: 'effect-api-handler',
      path: enableHandleWeb ? '*' : `${prefix}/*`,
      method: 'all',
      order: 'post',
      before,
      handler: async (c: Context, next: Next) => {
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
            c,
          );
        }

        const response = await dispatchEffectBffRequestWithContext(
          handler as EffectBffRequestHandler,
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

  dispose = async () => {
    this.retired = true;
    this.reloadGeneration += 1;
    this.unregisterRuntimeDisposer?.();
    this.unregisterRuntimeDisposer = undefined;
    const previous = this.handler;
    this.handler = null;
    await this.disposeHandler(previous);
  };

  onApiHandlersUpdated = async () => {
    if (!this.isEffect || this.retired || isProd()) {
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
    const generation = ++this.reloadGeneration;

    const entryFile = this.resolveEntryFile();
    if (!entryFile) {
      await this.installHandler(generation, null);
      return;
    }

    if (!(await fs.pathExists(entryFile))) {
      await this.installHandler(generation, null);
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

    const crossProjectPolicy = await resolveEffectAdapterCrossProjectPolicy(
      this.api,
      this.prefix,
      mod,
    );

    const loaded = await loadEffectAdapterHandlerFromModule(
      this.api,
      mod,
      crossProjectPolicy,
    );

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
    await this.installHandler(generation, candidate, crossProjectPolicy);
    if (this.retired) {
      throw new Error('Cannot initialize a retired Effect adapter.');
    }
  }

  private async installHandler(
    generation: number,
    candidate: DisposableServerRuntimeHandle | null,
    crossProjectPolicy?: ResolvedCrossProjectPolicy,
  ) {
    if (this.retired || generation !== this.reloadGeneration) {
      await this.disposeHandler(candidate);
      return;
    }
    const previous = this.handler;
    this.handler = candidate;
    this.crossProjectPolicy = crossProjectPolicy;
    await this.disposeHandler(previous);
  }

  private async disposeHandler(handler: DisposableServerRuntimeHandle | null) {
    if (!handler) {
      return;
    }
    try {
      await handler.dispose();
    } catch (error) {
      logger.warn(
        `[BFF][Effect] Failed dispose previous handler: ${String(error)}`,
      );
    }
  }
}

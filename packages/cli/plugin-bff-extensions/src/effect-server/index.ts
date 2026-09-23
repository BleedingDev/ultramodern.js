// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off nodeBuiltinImport:off strictBooleanExpressions:off

import path from 'node:path';
import '@modern-js/server-runtime-extensions/server-config';
import {
  dispatchEffectBffRequest,
  type EffectApiModule,
  type EffectBffRequestHandler,
  resolveEffectBffModuleHandler,
  useEffectContext,
} from '@modern-js/bff-effect/effect';
import type {
  Context,
  Next,
  ServerPlugin,
  ServerPluginAPI,
} from '@modern-js/server-core';
import { resolveOperationProducer } from '@modern-js/server-runtime-extensions/bff-policy/node';
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
import { resolveEffectServerCrossProjectPolicy } from './cross-project-policy';
import { resolveEffectServerEntryFile } from './entry';
import { createEffectServerRuntimeErrorResponse } from './error-response';

const EFFECT_MIDDLEWARE_BEFORE = [
  'custom-server-hook',
  'custom-server-middleware',
  'render',
];

export default (): ServerPlugin => ({
  name: '@modern-js/plugin-bff-extensions/effect-server',
  setup(api: ServerPluginAPI) {
    const runtimeFramework = api.getServerContext().bffRuntimeFramework;
    if (runtimeFramework !== 'effect') {
      throw new Error(
        `Effect BFF server plugin requires Effect; received "${runtimeFramework}".`,
      );
    }
    let handler: DisposableServerRuntimeHandle | null = null;
    let unregisterRuntimeDisposer: (() => void) | undefined;
    let prefix = '/api';
    let prefixes = ['/api'];
    let matchingPrefixes = ['/api'];
    let retired = false;

    const dispose = async () => {
      retired = true;
      unregisterRuntimeDisposer?.();
      unregisterRuntimeDisposer = undefined;
      const previous = handler;
      handler = null;
      await previous?.dispose();
    };

    const loadHandler = async () => {
      const entryFile = resolveEffectServerEntryFile(api);
      if (!entryFile || !(await fs.pathExists(entryFile))) {
        handler = null;
        return;
      }

      const { appDirectory } = api.getServerContext();
      let mod: EffectApiModule;
      try {
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

      const producer = resolveOperationProducer({
        directories: [path.dirname(entryFile), appDirectory],
        requestId: api.getServerConfig()?.bff?.requestId,
      });
      const crossProjectPolicies = new Map(
        await Promise.all(
          prefixes.map(
            async prefix =>
              [
                prefix,
                await resolveEffectServerCrossProjectPolicy(
                  api,
                  prefix,
                  mod,
                  producer,
                ),
              ] as const,
          ),
        ),
      );
      const effectConfig = api.getServerConfig()?.bff?.effect;
      const loaded = await resolveEffectBffModuleHandler(mod, {
        openapi: effectConfig?.openapi,
        dataPlatform: effectConfig?.dataPlatform,
        validateRequest: request => {
          const { path: mountedPathname } = useEffectContext();
          const prefix = matchingPrefixes.find(
            item =>
              item === '/' ||
              mountedPathname === item ||
              mountedPathname.startsWith(`${item}/`),
          );
          if (!prefix) return null;
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
      if (loaded.dispose)
        registerServerRuntimeDisposer(candidateOwner, loaded.dispose);
      const candidate = createDisposableServerRuntimeHandle(
        candidateOwner,
        loaded.handler,
      );
      if (retired) {
        await candidate.dispose();
        throw new Error('Cannot initialize a retired Effect server.');
      }
      handler = candidate;
    };

    api.onPrepare(async () => {
      const { middlewares: globalMiddlewares } = api.getServerContext();
      const configuredPrefix = api.getServerConfig()?.bff?.prefix;
      const enableHandleWeb = api.getServerConfig()?.bff?.enableHandleWeb;
      const configuredPrefixes = Array.isArray(configuredPrefix)
        ? configuredPrefix.filter(Boolean)
        : [configuredPrefix || '/api'];
      prefixes = [
        ...new Set(
          configuredPrefixes.length > 0 ? configuredPrefixes : ['/api'],
        ),
      ];
      matchingPrefixes = [...prefixes].sort(
        (left, right) => right.length - left.length,
      );
      prefix = prefixes[0] || '/api';
      const { serverBase } = api.getServerContext() as { serverBase?: object };
      if (serverBase)
        unregisterRuntimeDisposer = registerServerRuntimeDisposer(
          serverBase,
          dispose,
        );
      try {
        await loadHandler();
      } catch (error) {
        await dispose();
        throw error;
      }

      const middlewarePrefixes = enableHandleWeb ? [prefix] : matchingPrefixes;
      const middlewares = middlewarePrefixes.map(middlewarePrefix => ({
        name: 'effect-api-handler',
        path: enableHandleWeb ? '*' : `${middlewarePrefix}/*`,
        method: 'all' as const,
        order: 'post' as const,
        before: EFFECT_MIDDLEWARE_BEFORE,
        handler: async (context: Context, next: Next) => {
          const activeHandler = handler;
          if (!activeHandler) {
            if (enableHandleWeb) {
              await next();
              return;
            }
            return createEffectServerRuntimeErrorResponse(
              api,
              new Error(
                '[BFF][Effect] Missing Effect entry. Define api/index or configure bff.effect.entry.',
              ),
              context,
            );
          }

          const mountedPrefix = enableHandleWeb
            ? matchingPrefixes.find(
                item =>
                  item === '/' ||
                  context.req.path === item ||
                  context.req.path.startsWith(`${item}/`),
              ) || prefix
            : middlewarePrefix;
          const response = await dispatchEffectBffRequest(
            activeHandler as EffectBffRequestHandler,
            context.req.raw,
            {
              prefix: mountedPrefix,
              env: context.env as Record<string, unknown>,
              path: context.req.path,
              method: context.req.method,
              onError: error =>
                createEffectServerRuntimeErrorResponse(api, error, context),
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
    });
  },
});

// @effect-diagnostics anyUnknownInErrorContext:off asyncFunction:off strictBooleanExpressions:off
import {
  evaluateCrossProjectPolicy,
  type NormalizedCrossProjectPolicy,
  resolveCrossProjectRequestObservation,
} from '@modern-js/bff-core/security/cross-project-policy';
import { toHeaderRecord } from '../../utils/headers';
import {
  type DispatchEffectBffRequestOptions,
  dispatchEffectBffRequestWithContext,
} from './dispatch';
import { runWithEffectContext } from './edge-context';
import type {
  EffectBffOpenApiConfig,
  EffectDataPlatformValidationOptions,
} from './handler';
import {
  type EffectApiModule,
  type EffectBffRequestHandler,
  resolveEffectBffModuleHandler,
} from './module';
import type { EffectContext } from './operation-context';

export {
  runWithEffectContext,
  useEffectContext,
  useOperationContext,
} from './edge-context';
export * from './handler';
export {
  type CreateEffectOperationContextOptions,
  createEffectOperationContext,
  type EffectContext,
} from './operation-context';

export type EffectBffEdgeDispatchOptions = Omit<
  DispatchEffectBffRequestOptions,
  'runWithEffectContext'
>;

export type EffectBffEdgeHandlerOptions = {
  module: EffectApiModule;
  prefix?: string;
  openapi?: EffectBffOpenApiConfig;
  dataPlatform?: EffectDataPlatformValidationOptions;
  crossProjectPolicy?: NormalizedCrossProjectPolicy;
  onError?: (
    error: unknown,
    context: EffectContext,
  ) => Promise<Response> | Response;
  onWarning?: (message: string) => void;
};

const NORMALIZED_POLICY_BOOLEAN_FIELDS = [
  'enabled',
  'requireEnvelope',
  'requireOperationContext',
  'requireOperationContextDetails',
  'requireOperationSchemaHash',
  'requireOperationVersion',
  'allowUnknownOperations',
] as const;

function assertNormalizedCrossProjectPolicy(
  policy: NormalizedCrossProjectPolicy | undefined,
) {
  if (policy === undefined) {
    return;
  }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error(
      '[BFF][Effect] Edge cross-project policy must be a normalized object.',
    );
  }
  for (const field of NORMALIZED_POLICY_BOOLEAN_FIELDS) {
    if (typeof policy[field] !== 'boolean') {
      throw new Error(
        `[BFF][Effect] Edge cross-project policy requires boolean ${field}.`,
      );
    }
  }
  if (
    !policy.expectedOperationContracts ||
    typeof policy.expectedOperationContracts !== 'object' ||
    Array.isArray(policy.expectedOperationContracts)
  ) {
    throw new Error(
      '[BFF][Effect] Edge cross-project policy requires expectedOperationContracts object.',
    );
  }
}

function restoreEffectBffMountPath(
  request: Request,
  prefix: string | undefined,
) {
  const pathname = new URL(request.url).pathname;
  if (!prefix || prefix === '/') {
    return pathname;
  }
  const normalizedPrefix = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  return pathname === '/' ? normalizedPrefix : `${normalizedPrefix}${pathname}`;
}

export async function dispatchEffectBffRequest(
  handler: EffectBffRequestHandler,
  request: Request,
  options: EffectBffEdgeDispatchOptions = {},
): Promise<Response> {
  return dispatchEffectBffRequestWithContext(handler, request, {
    ...options,
    runWithEffectContext,
  });
}

export async function createEffectBffEdgeDispatcher(
  options: EffectBffEdgeHandlerOptions,
) {
  const crossProjectPolicy = options.crossProjectPolicy;
  assertNormalizedCrossProjectPolicy(crossProjectPolicy);
  const loaded = await resolveEffectBffModuleHandler(options.module, {
    openapi: options.openapi,
    dataPlatform: options.dataPlatform,
    validateRequest:
      crossProjectPolicy?.enabled === true
        ? request => {
            const pathname = new URL(request.url).pathname;
            const observedRequest = resolveCrossProjectRequestObservation(
              { method: request.method, pathname },
              crossProjectPolicy,
            ) ?? {
              method: request.method,
              routePath: restoreEffectBffMountPath(request, options.prefix),
            };
            const violation = evaluateCrossProjectPolicy(
              toHeaderRecord(request.headers),
              crossProjectPolicy,
              observedRequest,
            );
            if (!violation) {
              return null;
            }
            return new Response(
              JSON.stringify({
                code: violation.code,
                reason: violation.reason,
                message: violation.message,
              }),
              {
                status: violation.status,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                },
              },
            );
          }
        : undefined,
    onWarning: options.onWarning,
  });
  if (!loaded) {
    throw new Error(
      '[BFF][Effect] Invalid Effect edge module. Export defineEffectBff(...) or a { api, layer } HttpApi module.',
    );
  }

  return {
    dispatch: (
      request: Request,
      dispatchOptions: Omit<
        EffectBffEdgeDispatchOptions,
        'prefix' | 'onError'
      > = {},
    ) =>
      dispatchEffectBffRequest(loaded.handler, request, {
        ...dispatchOptions,
        prefix: options.prefix,
        onError: options.onError,
      }),
    dispose: async () => {
      await loaded.dispose?.();
    },
  };
}

export const createEffectBffTestHandler = createEffectBffEdgeHandler;

export async function createEffectBffEdgeHandler(
  options: EffectBffEdgeHandlerOptions,
) {
  const dispatcher = await createEffectBffEdgeDispatcher(options);

  return {
    handler: dispatcher.dispatch,
    dispose: dispatcher.dispose,
  };
}

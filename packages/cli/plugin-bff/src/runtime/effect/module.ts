import type * as EffectServiceContext from 'effect/Context';
import * as Context from 'effect/Context';
import { HttpApi } from 'effect/unstable/httpapi';
import {
  createHttpApiHandler,
  type EffectBffOpenApiConfig,
  type EffectDataPlatformValidationOptions,
  type EffectRequestValidator,
  type EffectRuntimeLayer,
  isValidatorAwareHandlerFactory,
} from './handler';
import type { EffectContext } from './operation-context';

export type EffectBffRequestHandler = (
  request: Request,
  context?: EffectServiceContext.Context<any> | EffectContext,
) => Promise<Response> | Response;

export type EffectBffHandlerFactory = (options?: {
  openapi?: EffectBffOpenApiConfig;
  dataPlatform?: EffectDataPlatformValidationOptions;
  validateRequest?: EffectRequestValidator;
}) => {
  handler: EffectBffRequestHandler;
  dispose: () => Promise<void>;
};

export type EffectApiModule = {
  api?: unknown;
  layer?: unknown;
  handler?: EffectBffRequestHandler;
  createHandler?: EffectBffHandlerFactory;
  default?: unknown;
};

export type LoadedEffectBffHandler = {
  handler: EffectBffRequestHandler;
  dispose?: () => Promise<void>;
};

export type ResolveEffectBffModuleHandlerOptions = {
  openapi?: EffectBffOpenApiConfig;
  dataPlatform?: EffectDataPlatformValidationOptions;
  /**
   * Server-seam request validator (cross-project policy). Strict Effect
   * entries forward it into `createHttpApiHandler`, where it applies to
   * direct, batched and rpc requests.
   */
  validateRequest?: EffectRequestValidator;
  onWarning?: (message: string) => void;
};

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

function isRequestHandler(value: unknown): value is EffectBffRequestHandler {
  return typeof value === 'function';
}

function isEffectApiDefinition(module: EffectApiModule): module is {
  api: HttpApi.AnyWithProps;
  layer: EffectRuntimeLayer;
  handler?: EffectBffRequestHandler;
  createHandler?: EffectBffHandlerFactory;
  default?: unknown;
} {
  return HttpApi.isHttpApi(module.api) && module.layer !== undefined;
}

function isEffectServiceContext(
  context: Parameters<EffectBffRequestHandler>[1],
): context is EffectServiceContext.Context<any> {
  return (
    typeof context === 'object' && context !== null && 'mapUnsafe' in context
  );
}

const emptyEffectServiceContext =
  Context.empty() as EffectServiceContext.Context<any>;

const strictEffectApproachMessage =
  '[BFF][Effect] strictEffectApproach is enforced: Effect API entries must export defineEffectBff(...) or a { api, layer } HttpApi module. Raw handler exports, default request handlers, and unbranded custom createHandler factories are not valid Effect API entries.';

function rejectLegacyEffectModuleShape(
  options: ResolveEffectBffModuleHandlerOptions,
  shape: string,
) {
  options.onWarning?.(`${strictEffectApproachMessage} Rejected ${shape}.`);
  return true;
}

function callEffectBffRequestHandler(
  handler: EffectBffRequestHandler,
  request: Request,
  context: Parameters<EffectBffRequestHandler>[1],
) {
  return context === undefined ? handler(request) : handler(request, context);
}

function createLoadedHandler(webHandler: {
  handler: EffectBffRequestHandler;
  dispose: () => Promise<void>;
}): LoadedEffectBffHandler {
  return {
    handler: (request, context) =>
      callEffectBffRequestHandler(webHandler.handler, request, context),
    dispose: webHandler.dispose,
  };
}

function createLoadedHttpApiHandler(
  webHandler: ReturnType<typeof createHttpApiHandler>,
): LoadedEffectBffHandler {
  return {
    handler: (request, context) => {
      const effectContext = isEffectServiceContext(context)
        ? context
        : emptyEffectServiceContext;
      return webHandler.handler(request, effectContext);
    },
    dispose: webHandler.dispose,
  };
}

function resolveNormalizedEffectBffModuleHandler(
  normalizedModule: EffectApiModule,
  options: ResolveEffectBffModuleHandlerOptions = {},
): LoadedEffectBffHandler | null {
  if (isRequestHandler(normalizedModule.handler)) {
    if (rejectLegacyEffectModuleShape(options, '`handler` export')) {
      return null;
    }
    return {
      handler: normalizedModule.handler,
    };
  }

  const entry = normalizedModule.default;
  if (isRequestHandler(entry)) {
    if (rejectLegacyEffectModuleShape(options, 'default request handler')) {
      return null;
    }
    return {
      handler: entry,
    };
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

  if (isRequestHandler(normalizedModule.handler)) {
    if (rejectLegacyEffectModuleShape(options, '`handler` export')) {
      return null;
    }
    return {
      handler: normalizedModule.handler,
    };
  }

  if (typeof normalizedModule.createHandler === 'function') {
    const factory = normalizedModule.createHandler;
    // Only `defineEffectBff`-branded factories are guaranteed to forward
    // `validateRequest` into `createHttpApiHandler`. A hand-written factory
    // matching the same shape may ignore it, so reject it like a plain
    // `handler` export.
    const validatorAware = isValidatorAwareHandlerFactory(factory);
    if (
      !validatorAware &&
      rejectLegacyEffectModuleShape(options, 'unbranded `createHandler` export')
    ) {
      return null;
    }
    const webHandler = factory({
      openapi: options.openapi,
      dataPlatform: options.dataPlatform,
      validateRequest: options.validateRequest,
    });
    return createLoadedHandler(webHandler);
  }

  if (isEffectApiDefinition(normalizedModule)) {
    options.onWarning?.(
      '[BFF][Effect] Detected { api, layer } export without createHandler. Prefer `defineEffectBff(...)` from @modern-js/plugin-bff/server to avoid module instance mismatch.',
    );
    const webHandler = createHttpApiHandler({
      api: normalizedModule.api,
      layer: normalizedModule.layer,
      openapi: options.openapi,
      dataPlatform: options.dataPlatform,
      validateRequest: options.validateRequest,
    });
    return createLoadedHttpApiHandler(webHandler);
  }

  return null;
}

export function resolveEffectBffModuleHandler(
  mod: EffectApiModule,
  options: ResolveEffectBffModuleHandlerOptions = {},
): Promise<LoadedEffectBffHandler | null> {
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
    if (rejectLegacyEffectModuleShape(options, '`handler` export')) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      handler: normalizedModule.handler,
    });
  }

  const entry = normalizedModule.default;
  if (isRequestHandler(entry)) {
    if (rejectLegacyEffectModuleShape(options, 'default request handler')) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      handler: entry,
    });
  }

  if (typeof entry === 'function' && entry.length === 0) {
    return Promise.resolve((entry as () => unknown | Promise<unknown>)()).then(
      out => {
        if (isRequestHandler(out)) {
          if (
            rejectLegacyEffectModuleShape(
              options,
              'default factory returning a request handler',
            )
          ) {
            return null;
          }
          return {
            handler: out,
          };
        }
        mergeRuntimeExports(out);
        return resolveNormalizedEffectBffModuleHandler(
          normalizedModule,
          options,
        );
      },
    );
  }

  return Promise.resolve(
    resolveNormalizedEffectBffModuleHandler(normalizedModule, options),
  );
}

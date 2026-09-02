// @effect-diagnostics strictBooleanExpressions:off
import type * as EffectServiceContext from 'effect/Context';
import { HttpApi } from 'effect/unstable/httpapi';
import {
  classifyEffectBffEntryModule,
  type EffectBffEntryShapeFacts,
  isValidatorAwareHandlerFactory,
  strictEffectApproachMessage,
} from './entry-shape';
import {
  createHttpApiHandler,
  type EffectBffOpenApiConfig,
  type EffectDataPlatformValidationOptions,
  type EffectRequestValidator,
  type EffectRuntimeLayer,
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

type LoadedEffectBffHandler = {
  handler: EffectBffRequestHandler;
  dispose?: () => Promise<void>;
};

type ResolveEffectBffModuleHandlerOptions = {
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

function isRequestHandler(value: unknown): value is EffectBffRequestHandler {
  return typeof value === 'function';
}

function shareDispose(dispose: () => Promise<void>) {
  let disposePromise: Promise<void> | undefined;
  return () => {
    disposePromise ??= Promise.resolve().then(dispose);
    return disposePromise;
  };
}

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
    dispose: shareDispose(webHandler.dispose),
  };
}

function createLoadedHttpApiHandler(
  webHandler: ReturnType<typeof createHttpApiHandler>,
): LoadedEffectBffHandler {
  return createLoadedHandler({
    handler: webHandler.handler as EffectBffRequestHandler,
    dispose: webHandler.dispose,
  });
}

function classifyEffectBffRuntimeEntryShape(module: EffectApiModule) {
  return classifyEffectBffEntryModule(module, {
    isRequestHandler,
    isValidatorAwareHandlerFactory,
    isHttpApi: HttpApi.isHttpApi,
  });
}

function resolveClassifiedEffectBffModuleHandler(
  facts: EffectBffEntryShapeFacts | null,
  options: ResolveEffectBffModuleHandlerOptions = {},
): LoadedEffectBffHandler | null {
  if (!facts) {
    return null;
  }

  if (facts.legacyShape) {
    if (rejectLegacyEffectModuleShape(options, facts.legacyShape)) {
      return null;
    }
  }

  if (typeof facts.createHandler === 'function') {
    if (facts.createHandlerValidatorAware) {
      const factory = facts.createHandler as EffectBffHandlerFactory;
      const webHandler = factory({
        openapi: options.openapi,
        dataPlatform: options.dataPlatform,
        validateRequest: options.validateRequest,
      });
      return createLoadedHandler(webHandler);
    }

    if (facts.api === undefined || !facts.hasRuntimeLayer) {
      rejectLegacyEffectModuleShape(
        options,
        'unbranded `createHandler` export',
      );
      return null;
    }

    options.onWarning?.(
      `${strictEffectApproachMessage} Ignored unbranded \`createHandler\` export and rebuilt the handler from its { api, layer } exports.`,
    );
  }

  if (facts.api !== undefined && facts.hasRuntimeLayer) {
    if (facts.createHandler === undefined) {
      options.onWarning?.(
        '[BFF][Effect] Detected { api, layer } export without createHandler. Prefer `defineEffectBff(...)` from @modern-js/bff-effect/effect to avoid module instance mismatch.',
      );
    }
    const webHandler = createHttpApiHandler({
      api: facts.api as HttpApi.Top,
      layer: facts.layer as EffectRuntimeLayer,
      openapi: options.openapi,
      dataPlatform: options.dataPlatform,
      validateRequest: options.validateRequest,
    });
    return createLoadedHttpApiHandler(webHandler);
  }

  return null;
}

function resolveNormalizedEffectBffModuleHandler(
  normalizedModule: EffectApiModule,
  options: ResolveEffectBffModuleHandlerOptions = {},
): LoadedEffectBffHandler | null {
  return resolveClassifiedEffectBffModuleHandler(
    classifyEffectBffRuntimeEntryShape(normalizedModule),
    options,
  );
}

export function resolveEffectBffModuleHandler(
  mod: EffectApiModule,
  options: ResolveEffectBffModuleHandlerOptions = {},
): Promise<LoadedEffectBffHandler | null> {
  return Promise.resolve(resolveNormalizedEffectBffModuleHandler(mod, options));
}

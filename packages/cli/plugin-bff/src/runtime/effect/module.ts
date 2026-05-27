import type * as EffectServiceContext from 'effect/Context';
import { HttpApi } from 'effect/unstable/httpapi';
import {
  createHttpApiHandler,
  type EffectBffOpenApiConfig,
  type EffectDataPlatformValidationOptions,
  type EffectRuntimeLayer,
} from './handler';
import type { EffectContext } from './operation-context';

export type EffectBffRequestHandler = (
  request: Request,
  context?: EffectServiceContext.Context<never> | EffectContext,
) => Promise<Response> | Response;

export type EffectBffHandlerFactory = (options?: {
  openapi?: EffectBffOpenApiConfig;
  dataPlatform?: EffectDataPlatformValidationOptions;
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

export async function resolveEffectBffModuleHandler(
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
    return {
      handler: normalizedModule.handler,
    };
  }

  const entry = normalizedModule.default;
  if (isRequestHandler(entry)) {
    return {
      handler: entry,
    };
  }

  if (typeof entry === 'function' && entry.length === 0) {
    const out = await entry();
    if (isRequestHandler(out)) {
      return {
        handler: out,
      };
    }
    mergeRuntimeExports(out);
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
    return {
      handler: normalizedModule.handler,
    };
  }

  if (typeof normalizedModule.createHandler === 'function') {
    const webHandler = normalizedModule.createHandler({
      openapi: options.openapi,
      dataPlatform: options.dataPlatform,
    });
    return {
      handler: async (request, context) => webHandler.handler(request, context),
      dispose: async () => {
        await webHandler.dispose();
      },
    };
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
    });
    return {
      handler: async (request, context) => webHandler.handler(request, context),
      dispose: async () => {
        await webHandler.dispose();
      },
    };
  }

  return null;
}

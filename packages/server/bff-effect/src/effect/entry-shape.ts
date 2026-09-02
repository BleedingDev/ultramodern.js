type ValidatorAwareHandlerFactoryRegistry = {
  register<TFactory extends Function>(factory: TFactory): TFactory;
  is(factory: unknown): boolean;
};

function createLocalValidatorAwareHandlerFactoryRegistry(): ValidatorAwareHandlerFactoryRegistry {
  const factories = new WeakSet<Function>();
  return {
    register<TFactory extends Function>(factory: TFactory): TFactory {
      factories.add(factory);
      return factory;
    },
    is(factory: unknown): boolean {
      return typeof factory === 'function' && factories.has(factory);
    },
  };
}

function loadNodeValidatorAwareHandlerFactoryRegistry(): ValidatorAwareHandlerFactoryRegistry {
  const moduleUrl = import.meta.url;
  if (typeof moduleUrl !== 'string' || !moduleUrl.startsWith('file:')) {
    return createLocalValidatorAwareHandlerFactoryRegistry();
  }

  const moduleBuiltin = process.getBuiltinModule(
    'node:module',
  ) as typeof import('node:module');
  try {
    return moduleBuiltin.createRequire(moduleUrl)(
      `#effect-entry-shape-${'registry'}`,
    ) as ValidatorAwareHandlerFactoryRegistry;
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'MODULE_NOT_FOUND'
    ) {
      return createLocalValidatorAwareHandlerFactoryRegistry();
    }
    throw error;
  }
}

const validatorAwareHandlerFactoryRegistry =
  process.env.MODERN_EFFECT_NODE_RUNTIME === 'true'
    ? loadNodeValidatorAwareHandlerFactoryRegistry()
    : createLocalValidatorAwareHandlerFactoryRegistry();

type EffectBffEntryModule = {
  api?: unknown;
  layer?: unknown;
  handler?: unknown;
  createHandler?: unknown;
  default?: unknown;
};

type LegacyEffectBffEntryShape = '`handler` export' | 'default request handler';

export type EffectBffEntryShapeFacts = {
  module: EffectBffEntryModule;
  legacyShape?: LegacyEffectBffEntryShape;
  createHandler?: unknown;
  createHandlerValidatorAware: boolean;
  api?: unknown;
  layer?: unknown;
  hasRuntimeLayer: boolean;
};

type EffectBffEntryShapePredicates = {
  isRequestHandler: (value: unknown) => boolean;
  isValidatorAwareHandlerFactory: (value: unknown) => boolean;
  isHttpApi: (value: unknown) => boolean;
};

/** @internal Registers factories created by `defineEffectBff`. */
export function registerValidatorAwareHandlerFactory<TFactory extends Function>(
  factory: TFactory,
): TFactory {
  return validatorAwareHandlerFactoryRegistry.register(factory);
}

/**
 * True when a custom createHandler factory is produced by defineEffectBff and
 * therefore forwards strict cross-project validation into createHttpApiHandler.
 */
export function isValidatorAwareHandlerFactory(factory: unknown): boolean {
  return validatorAwareHandlerFactoryRegistry.is(factory);
}

export const strictEffectApproachMessage =
  '[BFF][Effect] strictEffectApproach is enforced: Effect API entries export defineEffectBff(...) or { api, layer } HttpApi module. Raw handler exports, default request handlers, unbranded custom createHandler factories not valid Effect API entries.';

function isEffectEntryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function classifyEffectBffEntryModule(
  value: unknown,
  predicates: EffectBffEntryShapePredicates,
): EffectBffEntryShapeFacts | null {
  if (!isEffectEntryRecord(value)) {
    return null;
  }

  const rootModule = value;

  if (predicates.isRequestHandler(rootModule.handler)) {
    return createEntryShapeFacts(rootModule, predicates, '`handler` export');
  }

  const defaultEntry = rootModule.default;
  if (predicates.isRequestHandler(defaultEntry)) {
    return createEntryShapeFacts(
      rootModule,
      predicates,
      'default request handler',
    );
  }

  const module = isEffectEntryRecord(defaultEntry)
    ? { ...rootModule, ...defaultEntry }
    : rootModule;

  if (predicates.isRequestHandler(module.handler)) {
    return createEntryShapeFacts(module, predicates, '`handler` export');
  }

  return createEntryShapeFacts(module, predicates);
}

function createEntryShapeFacts(
  module: EffectBffEntryModule,
  predicates: EffectBffEntryShapePredicates,
  legacyShape?: LegacyEffectBffEntryShape,
): EffectBffEntryShapeFacts {
  const createHandler =
    typeof module.createHandler === 'function'
      ? module.createHandler
      : undefined;
  const api = predicates.isHttpApi(module.api) ? module.api : undefined;
  const hasRuntimeLayer = module.layer !== undefined;

  return {
    module,
    legacyShape,
    createHandler,
    createHandlerValidatorAware:
      createHandler !== undefined &&
      predicates.isValidatorAwareHandlerFactory(createHandler),
    api,
    layer: module.layer,
    hasRuntimeLayer,
  };
}

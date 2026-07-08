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

export const EFFECT_VALIDATOR_AWARE_FACTORY: symbol = Symbol.for(
  'modernjs.effect.validatorAware',
);

/**
 * True when a custom createHandler factory is produced by defineEffectBff and
 * therefore forwards strict cross-project validation into createHttpApiHandler.
 */
export function isValidatorAwareHandlerFactory(factory: unknown): boolean {
  return Boolean(
    typeof factory === 'function' &&
      (factory as unknown as Record<PropertyKey, unknown>)[
        EFFECT_VALIDATOR_AWARE_FACTORY
      ],
  );
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

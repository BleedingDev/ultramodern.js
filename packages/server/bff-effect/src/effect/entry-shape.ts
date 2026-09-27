import type { EffectRpcBffDefinition } from './handler/types';

type ValidatorAwareHandlerFactoryRegistry = {
  register<TFactory extends Function>(factory: TFactory): TFactory;
  is(factory: unknown): boolean;
};

/**
 * Module Federation share through which a backend federation host hands its
 * package-private handler factory registry to the containers it initializes.
 */
export const EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE =
  '@modern-js/bff-effect/handler-factory-registry';

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
    // A bundled backend federation container has no file URL; its host share
    // arrives through adoptEffectBffShareScope() during container init.
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

declare const __MODERN_EFFECT_NODE_RUNTIME__: boolean;

let validatorAwareHandlerFactoryRegistry:
  | ValidatorAwareHandlerFactoryRegistry
  | undefined;

function handlerFactoryRegistry(): ValidatorAwareHandlerFactoryRegistry {
  validatorAwareHandlerFactoryRegistry ??=
    typeof __MODERN_EFFECT_NODE_RUNTIME__ !== 'undefined' &&
    __MODERN_EFFECT_NODE_RUNTIME__
      ? loadNodeValidatorAwareHandlerFactoryRegistry()
      : createLocalValidatorAwareHandlerFactoryRegistry();
  return validatorAwareHandlerFactoryRegistry;
}

type SharedVersions = Record<string, { get?: () => unknown } | undefined>;

/**
 * @internal Called by generated backend federation containers from `init()`,
 * before any expose evaluates, so factories created by `defineEffectBff`
 * register with the host's registry instead of a bundle-local one.
 */
export function adoptEffectBffShareScope(shareScope: unknown): Promise<void> {
  const versions =
    typeof shareScope === 'object' && shareScope !== null
      ? (shareScope as Record<string, SharedVersions | undefined>)[
          EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE
        ]
      : undefined;
  const shared =
    versions === undefined ? undefined : Object.values(versions)[0];
  if (typeof shared?.get !== 'function') {
    return Promise.resolve();
  }
  return Promise.resolve(shared.get()).then(factory =>
    adoptHandlerFactoryRegistry(
      (typeof factory === 'function' ? factory() : undefined) as
        | ValidatorAwareHandlerFactoryRegistry
        | undefined,
    ),
  );
}

function adoptHandlerFactoryRegistry(
  registry: ValidatorAwareHandlerFactoryRegistry | undefined,
): void {
  if (
    typeof registry?.register !== 'function' ||
    typeof registry.is !== 'function'
  ) {
    throw new Error(
      `[BFF][Effect] Share ${EFFECT_BFF_HANDLER_FACTORY_REGISTRY_SHARE} must provide a handler factory registry.`,
    );
  }
  if (
    validatorAwareHandlerFactoryRegistry !== undefined &&
    validatorAwareHandlerFactoryRegistry !== registry
  ) {
    throw new Error(
      '[BFF][Effect] A backend federation container received the host handler factory registry after an Effect API already used its own. Evaluate exposes only after container init().',
    );
  }
  validatorAwareHandlerFactoryRegistry = registry;
}

type EffectBffEntryModule = {
  api?: unknown;
  layer?: unknown;
  rpc?: EffectRpcBffDefinition;
  handler?: unknown;
  createHandler?: unknown;
  default?: unknown;
};

type UnsupportedEffectBffEntryShape =
  | '`handler` export'
  | 'default request handler';

export type EffectBffEntryShapeFacts = {
  module: EffectBffEntryModule;
  unsupportedShape?: UnsupportedEffectBffEntryShape;
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
  return handlerFactoryRegistry().register(factory);
}

/**
 * True when a custom createHandler factory is produced by defineEffectBff and
 * therefore forwards strict cross-project validation into createHttpApiHandler.
 */
export function isValidatorAwareHandlerFactory(factory: unknown): boolean {
  return handlerFactoryRegistry().is(factory);
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
  unsupportedShape?: UnsupportedEffectBffEntryShape,
): EffectBffEntryShapeFacts {
  const createHandler =
    typeof module.createHandler === 'function'
      ? module.createHandler
      : undefined;
  const api = predicates.isHttpApi(module.api) ? module.api : undefined;
  const hasRuntimeLayer = module.layer !== undefined;

  return {
    module,
    unsupportedShape,
    createHandler,
    createHandlerValidatorAware:
      createHandler !== undefined &&
      predicates.isValidatorAwareHandlerFactory(createHandler),
    api,
    layer: module.layer,
    hasRuntimeLayer,
  };
}

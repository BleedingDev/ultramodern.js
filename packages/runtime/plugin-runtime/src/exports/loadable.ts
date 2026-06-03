import * as loadableModule from '@loadable/component';

function resolveLoadable(module: unknown) {
  const namespace = module as {
    default?: unknown;
    lazy?: unknown;
    loadableReady?: unknown;
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: unknown;
  };
  const defaultExport = namespace.default as
    | {
        default?: unknown;
        lazy?: unknown;
        loadableReady?: unknown;
        __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: unknown;
      }
    | undefined;
  const candidates = [module, namespace.default, defaultExport?.default];
  const loadable = candidates.find(
    candidate => typeof candidate === 'function',
  );

  if (!loadable) {
    throw new TypeError(
      'Modern.js runtime loadable export must resolve to a function',
    );
  }

  return loadable as typeof import('@loadable/component').default;
}

const loadable = resolveLoadable(loadableModule);

export const lazy =
  loadableModule.lazy ?? loadableModule.default?.lazy ?? loadable.lazy;
export const loadableReady =
  loadableModule.loadableReady ??
  loadableModule.default?.loadableReady ??
  loadable.loadableReady;
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
  loadableModule.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ??
  loadableModule.default?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ??
  loadable.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

export default loadable;

export * from '@loadable/component';

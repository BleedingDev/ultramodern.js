import * as loadableModule from '@loadable/component';

type LoadableDefault = typeof import('@loadable/component').default;
type LoadableLazy = typeof import('@loadable/component').lazy;
type LoadableReady = typeof import('@loadable/component').loadableReady;
type LoadableInternals =
  typeof import('@loadable/component').__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

function resolveLoadable(module: unknown): LoadableDefault {
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

  return loadable as LoadableDefault;
}

const loadable: LoadableDefault = resolveLoadable(loadableModule);

export const lazy: LoadableLazy =
  loadableModule.lazy ?? loadableModule.default?.lazy ?? loadable.lazy;
export const loadableReady: LoadableReady =
  loadableModule.loadableReady ??
  loadableModule.default?.loadableReady ??
  loadable.loadableReady;
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: LoadableInternals =
  loadableModule.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ??
  loadableModule.default?.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ??
  loadable.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

export default loadable;

export * from '@loadable/component';

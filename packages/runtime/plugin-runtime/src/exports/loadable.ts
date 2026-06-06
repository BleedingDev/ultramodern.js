import * as loadableModule from '@loadable/component';

type LoadableDefault = typeof import('@loadable/component').default;
type LoadableLazy = typeof import('@loadable/component').lazy;
type LoadableReady = typeof import('@loadable/component').loadableReady;
type LoadableInternals = unknown;
type LoadableNamespace = {
  default?: unknown;
  lazy?: unknown;
  loadableReady?: unknown;
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: unknown;
};

function asLoadableNamespace(value: unknown): LoadableNamespace {
  return typeof value === 'object' && value !== null
    ? (value as LoadableNamespace)
    : {};
}

function resolveLoadable(module: unknown): LoadableDefault {
  const namespace = asLoadableNamespace(module);
  const defaultExport = asLoadableNamespace(namespace.default);
  const candidates = [module, namespace.default, defaultExport?.default];
  const loadable = candidates.find(
    candidate => typeof candidate === 'function',
  );

  if (typeof loadable !== 'function') {
    throw new TypeError(
      'Modern.js runtime loadable export must resolve to a function',
    );
  }

  return loadable as LoadableDefault;
}

const loadable: LoadableDefault = resolveLoadable(loadableModule);
const loadableNamespace = asLoadableNamespace(loadableModule);
const loadableDefaultNamespace = asLoadableNamespace(loadableNamespace.default);
const callableLoadableNamespace = asLoadableNamespace(loadable);

export const lazy: LoadableLazy = (loadableNamespace.lazy ??
  loadableDefaultNamespace.lazy ??
  callableLoadableNamespace.lazy) as LoadableLazy;
export const loadableReady: LoadableReady = (loadableNamespace.loadableReady ??
  loadableDefaultNamespace.loadableReady ??
  callableLoadableNamespace.loadableReady) as LoadableReady;
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: LoadableInternals =
  loadableNamespace.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ??
  loadableDefaultNamespace.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED ??
  callableLoadableNamespace.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

export default loadable;

export * from '@loadable/component';

import { Dynamic, isServer, type JSX } from '@solidjs/web';
import {
  type Component,
  createMemo,
  createSignal,
  isHydrating,
  onSettled,
} from 'solid-js';

/** The module shape a same-renderer Module Federation remote exposes. */
export interface FederatedModule<P extends object> {
  readonly default: Component<P>;
}

export interface FederatedComponentOptions {
  /** Rendered on the server, during hydration and until the remote has loaded. */
  readonly fallback?: () => JSX.Element;
}

interface FederationInstance {
  loadRemote<T>(id: string): Promise<T | null>;
}

/** Published by the host build's native federation runtime plugin. */
const HOST_INSTANCE = Symbol.for('ultramodern.federation.host-instance');

function loadFederatedModule<P extends object>(
  id: string,
): Promise<FederatedModule<P>> {
  const instance = (globalThis as Record<symbol, unknown>)[HOST_INSTANCE] as
    | FederationInstance
    | undefined;
  if (!instance)
    return Promise.reject(
      new Error(
        `Cannot load ${id}: this application has no Module Federation runtime. Add module-federation.config.ts with its remotes.`,
      ),
    );
  return instance.loadRemote<FederatedModule<P>>(id).then(module => {
    if (!module) throw new Error(`Remote module ${id} is unavailable`);
    return module;
  });
}

/**
 * Render a Solid component exposed by a Module Federation remote, by its
 * `remote/Expose` id or a custom loader.
 *
 * Remote components are client-only: the server and the hydration pass render
 * the fallback, and the remote loads once the host root has settled. Load and
 * renderer-admission failures throw to the nearest `Errored` boundary.
 */
export function federatedComponent<P extends object = Record<string, never>>(
  remote: string | (() => Promise<FederatedModule<P>>),
  options: FederatedComponentOptions = {},
): Component<P> {
  if (
    typeof remote === 'string'
      ? !/^[^/]+\/.+/u.test(remote)
      : typeof remote !== 'function'
  )
    throw new TypeError(
      "federatedComponent requires a remote id such as 'remote/Widget' or a loader",
    );
  const load =
    typeof remote === 'string' ? () => loadFederatedModule<P>(remote) : remote;
  let loaded: Component<P> | undefined;
  let pending: Promise<Component<P>> | undefined;
  const resolve = (): Promise<Component<P>> =>
    (pending ??= Promise.resolve()
      .then(load)
      .then(
        module => {
          const component = module?.default;
          if (typeof component !== 'function')
            throw new TypeError(
              'A federated Solid module must default-export a component',
            );
          loaded = component;
          return component;
        },
        error => {
          // A later mount may retry after a transient network failure.
          pending = undefined;
          throw error;
        },
      ));
  const fallback = (): JSX.Element => options.fallback?.();

  return (props: P): JSX.Element => {
    if (isServer) return fallback();
    // Hydration must claim the fallback the server produced.
    const [state, setState] = createSignal<{
      component?: Component<P>;
      failure?: { reason: unknown };
    }>({ component: isHydrating() ? undefined : loaded });
    onSettled(() => {
      if (state().component) return;
      resolve().then(
        component => setState({ component }),
        reason => setState({ failure: { reason } }),
      );
    });
    // A memo owns the failure, so Errored boundaries observe it; a bare
    // accessor would surface it outside the boundary.
    const view = createMemo((): JSX.Element => {
      const current = state();
      if (current.failure) throw current.failure.reason;
      return current.component ? (
        <Dynamic component={current.component} {...props} />
      ) : (
        fallback()
      );
    });
    return view as unknown as JSX.Element;
  };
}

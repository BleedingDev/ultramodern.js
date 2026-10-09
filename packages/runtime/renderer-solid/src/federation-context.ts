import {
  type FederationInstance,
  getFederationHost,
  type NativeFederationBinding,
} from '@modern-js/renderer-core/federation';
import type { JSX } from '@solidjs/web';
import { createComponent, createContext } from 'solid-js';

/** One application owns its host runtime; each response owns its render scope. */
export interface SolidFederationScope {
  readonly instance: FederationInstance | undefined;
  /** Server scopes: the host's client module that hydrates a remote. */
  readonly hydrationModule?: string;
}

/** Outside a generated entry, remote ids have no host; custom loaders work. */
export const FederationContext = createContext<SolidFederationScope>(
  Object.freeze({ instance: undefined }),
);

export function createFederationScope(
  binding: NativeFederationBinding | undefined,
): SolidFederationScope | undefined {
  if (binding === undefined) return undefined;
  const instance = getFederationHost(binding);
  return binding.hydrationModule === undefined
    ? { instance }
    : { instance, hydrationModule: binding.hydrationModule };
}

/**
 * Provide the scope to an application view. The server and the browser wrap
 * the same view, so both render the provider at the same hydration position.
 */
export function provideFederation(
  scope: SolidFederationScope | undefined,
  view: () => JSX.Element,
): () => JSX.Element {
  if (!scope) return view;
  return () =>
    createComponent(FederationContext, {
      value: scope,
      get children() {
        return view();
      },
    });
}

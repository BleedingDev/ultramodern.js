import {
  type FederationInstance,
  getFederationHost,
  type NativeFederationBinding,
} from '@modern-js/renderer-core/federation';
import { type ComponentBody, createContext, createElement } from 'octane';

/** One application owns its host runtime; each response owns its render scope. */
export interface OctaneFederationScope {
  readonly instance: FederationInstance | undefined;
  readonly server: boolean;
  readonly nonce?: string;
}

export const FederationContext = createContext<OctaneFederationScope | null>(
  null,
);

export function createFederationScope(
  binding: NativeFederationBinding | undefined,
  server: boolean,
  nonce?: string,
): OctaneFederationScope {
  return {
    instance: getFederationHost(binding),
    server,
    ...(nonce === undefined ? {} : { nonce }),
  };
}

export function FederationRoot(props: {
  readonly scope: OctaneFederationScope;
  readonly children?: unknown;
}) {
  return createElement(FederationContext, {
    value: props.scope,
    children: props.children,
  });
}

/** A stable root component retains native state when its application updates. */
export function FederationApplication(props: {
  readonly scope: OctaneFederationScope;
  readonly application: {
    readonly default: ComponentBody;
    readonly props?: unknown;
  };
}) {
  return createElement(FederationRoot, {
    scope: props.scope,
    children: createElement(props.application.default, props.application.props),
  });
}

import {
  getRouterRuntimeState,
  type InternalRouterRuntimeState,
} from '@modern-js/runtime/context';
import type { AnyRouter } from '@tanstack/react-router';

/**
 * Router runtime state as published by the TanStack router provider into the
 * runtime-context extension slot.
 */
export interface TanstackRouterState
  extends Omit<InternalRouterRuntimeState, 'framework' | 'instance'> {
  framework: 'tanstack';
  instance?: AnyRouter;
}

/**
 * Typed accessor for the TanStack router state stored on a Modern.js runtime
 * context. Returns `undefined` when the active router provider is not
 * TanStack (e.g. react-router) or no router has been created yet.
 */
export function getTanstackRouterState(
  context: object,
): TanstackRouterState | undefined {
  const state = getRouterRuntimeState(context);
  if (
    state === undefined ||
    state.framework !== 'tanstack' ||
    state.instance === undefined
  ) {
    return undefined;
  }

  return state as TanstackRouterState;
}

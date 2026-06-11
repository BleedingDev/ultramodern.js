/**
 * Fork-owned helmet state, stored via the runtime-context extension slot
 * instead of an ad-hoc `_helmetContext` field on `TInternalRuntimeContext`.
 */
import type { HelmetServerState } from 'react-helmet-async';
import { createRuntimeContextExtension } from './extensions';

export interface HelmetContextSlot {
  helmet?: HelmetServerState | null;
}

const helmetContextExtension = createRuntimeContextExtension<HelmetContextSlot>(
  '@modern-js/runtime:helmet-context',
);

export function getHelmetContext(
  context: object,
): HelmetContextSlot | undefined {
  return helmetContextExtension.get(context);
}

export function ensureHelmetContext(context: object): HelmetContextSlot {
  const existing = helmetContextExtension.get(context);
  if (existing) {
    return existing;
  }

  const created: HelmetContextSlot = {};
  helmetContextExtension.set(context, created);
  return created;
}

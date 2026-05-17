// @effect-diagnostics strictBooleanExpressions:off
'use client';

import type React from 'react';
import { useSlotContext } from './SlotContext';

export function ClientSlot({ args, slot }: { args: unknown[]; slot: string }) {
  const context = useSlotContext();
  if (!context) {
    throw new Error('ClientSlot must be rendered inside CompositeComponent.');
  }

  const implementation = context.implementations[slot];
  if (typeof implementation === 'undefined') {
    if (context.strict) {
      throw new Error(`Missing RSC slot implementation for "${slot}".`);
    }
    return null;
  }

  if (typeof implementation === 'function') {
    return <>{implementation(...args)}</>;
  }

  return <>{implementation as React.ReactNode}</>;
}

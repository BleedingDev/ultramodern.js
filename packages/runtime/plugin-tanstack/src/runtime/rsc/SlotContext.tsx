'use client';

import type React from 'react';
import { createContext, use } from 'react';

type SlotImplementations = Record<string, unknown>;

const SlotContext = createContext<{
  implementations: SlotImplementations;
  strict: boolean;
} | null>(null);

export function useSlotContext() {
  return use(SlotContext);
}

export function SlotProvider({
  children,
  implementations,
  strict,
}: {
  children?: React.ReactNode;
  implementations: SlotImplementations;
  strict?: boolean;
}) {
  return (
    <SlotContext value={{ implementations, strict: strict === true }}>
      {children}
    </SlotContext>
  );
}

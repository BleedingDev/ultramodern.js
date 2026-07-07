import type React from 'react';
import type { RscSlotUsageEvent } from './symbols';

export const TANSTACK_RSC_FLIGHT_VALUE = '__modernTanstackRsc';

export type SerializedTanstackRscFlightValue = {
  [TANSTACK_RSC_FLIGHT_VALUE]: true;
  kind: 'renderable' | 'composite';
  slotUsagesStream?: ReadableStream<RscSlotUsageEvent>;
  stream: ReadableStream<Uint8Array>;
};

export function isSerializedTanstackRscFlightValue(
  value: unknown,
): value is SerializedTanstackRscFlightValue {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { [TANSTACK_RSC_FLIGHT_VALUE]?: unknown })[
      TANSTACK_RSC_FLIGHT_VALUE
    ] === true &&
    ((value as { kind?: unknown }).kind === 'renderable' ||
      (value as { kind?: unknown }).kind === 'composite') &&
    (value as { stream?: unknown }).stream instanceof ReadableStream
  );
}

export function EmptyFallback() {
  return null;
}

export function selectTreePath(tree: unknown, path: string[]) {
  let current = tree;
  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current as React.ReactNode;
}

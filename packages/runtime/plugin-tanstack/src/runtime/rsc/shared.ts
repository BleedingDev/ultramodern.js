import type React from 'react';
import {
  type AnyCompositeComponent,
  type AnyRenderableServerComponent,
  RSC_PROXY_GET_TREE,
  RSC_PROXY_PATH,
  type RscSlotUsageEvent,
} from './symbols';

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

function selectTreePath(tree: unknown, path: string[]) {
  let current = tree;
  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current as React.ReactNode;
}

type RenderSelectedTreeSource =
  | AnyRenderableServerComponent
  | AnyCompositeComponent;

type RenderSelectedTreeOptions = {
  getTree?: (() => unknown) | undefined;
  missingTreeError: string;
};

export function renderSelectedTree(
  src: RenderSelectedTreeSource,
  {
    getTree = src[RSC_PROXY_GET_TREE],
    missingTreeError,
  }: RenderSelectedTreeOptions,
) {
  if (!getTree) {
    throw new Error(missingTreeError);
  }

  return selectTreePath(getTree(), src[RSC_PROXY_PATH] || []);
}

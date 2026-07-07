// @effect-diagnostics strictBooleanExpressions:off
'use client';

import { Suspense } from 'react';
import { SlotProvider } from './SlotContext';
import { EmptyFallback, selectTreePath } from './shared';
import {
  type AnyCompositeComponent,
  type CompositeComponentProps,
  RSC_PROXY_GET_TREE,
  RSC_PROXY_PATH,
  SERVER_COMPONENT_STREAM,
} from './symbols';
import { createTreeGetterFromFlightStream } from './treeGetter';

const rawServerValueGetters = new WeakMap<object, () => unknown>();

function getRawServerTreeGetter(src: unknown) {
  if (!src || (typeof src !== 'object' && typeof src !== 'function')) {
    return;
  }

  const source = src as {
    [SERVER_COMPONENT_STREAM]?: {
      createReplayStream?: () => ReadableStream<Uint8Array>;
    };
  };
  const stream = source[SERVER_COMPONENT_STREAM];
  if (typeof stream?.createReplayStream !== 'function') {
    return;
  }

  let getTree = rawServerValueGetters.get(src);
  if (!getTree) {
    getTree = createTreeGetterFromFlightStream(stream.createReplayStream());
    rawServerValueGetters.set(src, getTree);
  }

  return getTree;
}

function CompositeInner<TComp extends AnyCompositeComponent>({
  slotProps,
  src,
  strict,
}: {
  slotProps: Record<string, unknown>;
  src: TComp;
  strict?: boolean;
}) {
  const getTree = src[RSC_PROXY_GET_TREE] || getRawServerTreeGetter(src);
  if (!getTree) {
    throw new Error(
      'CompositeComponent src must come from createCompositeComponent().',
    );
  }

  const tree = selectTreePath(getTree(), src[RSC_PROXY_PATH] || []);
  return (
    <SlotProvider implementations={slotProps} strict={strict}>
      {tree}
    </SlotProvider>
  );
}

export function CompositeComponent<TComp extends AnyCompositeComponent>(
  props: CompositeComponentProps<TComp>,
) {
  const { children, src, strict, ...slotProps } = props;
  return (
    <Suspense fallback={<EmptyFallback />}>
      <CompositeInner
        slotProps={{ ...slotProps, children }}
        src={src}
        strict={strict}
      />
    </Suspense>
  );
}

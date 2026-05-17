// @effect-diagnostics strictBooleanExpressions:off
'use client';

import type React from 'react';
import { Suspense } from 'react';
import { SlotProvider } from './SlotContext';
import {
  type AnyCompositeComponent,
  type CompositeComponentProps,
  RSC_PROXY_GET_TREE,
  RSC_PROXY_PATH,
} from './symbols';

function EmptyFallback() {
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

function CompositeInner<TComp extends AnyCompositeComponent>({
  slotProps,
  src,
  strict,
}: {
  slotProps: Record<string, unknown>;
  src: TComp;
  strict?: boolean;
}) {
  const getTree = src[RSC_PROXY_GET_TREE];
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

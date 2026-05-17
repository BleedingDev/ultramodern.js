// @effect-diagnostics strictBooleanExpressions:off
'use client';

import type React from 'react';
import { Suspense } from 'react';
import {
  type AnyRenderableServerComponent,
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

function RscNodeRenderInner({ data }: { data: AnyRenderableServerComponent }) {
  const getTree = data[RSC_PROXY_GET_TREE];
  if (!getTree) {
    throw new Error('Renderable RSC is missing its decoded tree getter.');
  }

  return <>{selectTreePath(getTree(), data[RSC_PROXY_PATH] || [])}</>;
}

export function RscNodeRenderer({
  data,
}: {
  data: AnyRenderableServerComponent;
}) {
  return (
    <Suspense fallback={<EmptyFallback />}>
      <RscNodeRenderInner data={data} />
    </Suspense>
  );
}

// @effect-diagnostics strictBooleanExpressions:off
'use client';

import { Suspense } from 'react';
import { EmptyFallback, selectTreePath } from './shared';
import {
  type AnyRenderableServerComponent,
  RSC_PROXY_GET_TREE,
  RSC_PROXY_PATH,
} from './symbols';

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

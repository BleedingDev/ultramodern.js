// @effect-diagnostics strictBooleanExpressions:off
'use client';

import { Suspense } from 'react';
import { EmptyFallback, renderSelectedTree } from './shared';
import type { AnyRenderableServerComponent } from './symbols';

function RscNodeRenderInner({ data }: { data: AnyRenderableServerComponent }) {
  return (
    <>
      {renderSelectedTree(data, {
        missingTreeError: 'Renderable RSC is missing its decoded tree getter.',
      })}
    </>
  );
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

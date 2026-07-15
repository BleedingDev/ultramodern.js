import type { ReactNode } from 'react';
import { useRuntimeContext } from '../core/context/runtime';

export const DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY =
  '__modernDistributedSsrFragments';

export type DistributedSsrFragment = {
  boundaryId: string;
  expose: string;
  html: string;
  remote: string;
  status: 'ready';
};

export type DistributedSsrFragmentFailure = {
  boundaryId: string;
  expose: string;
  reason: string;
  remote: string;
  status: 'degraded';
};

export type DistributedSsrFragmentContext = {
  fragments: Record<
    string,
    DistributedSsrFragment | DistributedSsrFragmentFailure
  >;
  required: true;
};

export type DistributedSsrBoundaryProps = {
  children: ReactNode;
  expose: string;
  fallback: ReactNode;
  remote: string;
};

export function distributedSsrFragmentKey(remote: string, expose: string) {
  return `${remote}::${expose}`;
}

function getDistributedSsrFragmentContext(
  response: Record<string, unknown> | undefined,
): DistributedSsrFragmentContext | undefined {
  const locals = response?.locals;
  if (!locals || typeof locals !== 'object') {
    return undefined;
  }

  const context = (locals as Record<string, unknown>)[
    DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY
  ];

  if (!context || typeof context !== 'object') {
    return undefined;
  }

  return context as DistributedSsrFragmentContext;
}

/**
 * Keeps the browser on the native Module Federation component while allowing
 * servers that cannot execute remote code (notably workerd) to render a
 * trusted fragment produced by the remote Worker itself.
 *
 * Node SSR has no distributed-fragment context and therefore renders the
 * child normally, preserving Module Federation's in-process SSR path.
 */
export function DistributedSsrBoundary({
  children,
  expose,
  fallback,
  remote,
}: DistributedSsrBoundaryProps) {
  const runtimeContext = useRuntimeContext();
  const key = distributedSsrFragmentKey(remote, expose);
  const attributes = {
    'data-modern-distributed-ssr-boundary': key,
  };

  if (runtimeContext.isBrowser) {
    return <div {...attributes}>{children}</div>;
  }

  const fragmentContext = getDistributedSsrFragmentContext(
    runtimeContext.requestContext?.response,
  );

  // Node can execute the Module Federation server runtime. Only workerd's
  // request adapter supplies a required distributed-fragment context.
  if (!fragmentContext) {
    return <div {...attributes}>{children}</div>;
  }

  const fragment = fragmentContext.fragments[key];
  if (fragment?.status === 'ready') {
    return (
      <div
        {...attributes}
        data-modern-distributed-ssr-status="ready"
        // The fragment is accepted only after the Worker adapter verifies its
        // declared boundary id and expose marker.
        dangerouslySetInnerHTML={{ __html: fragment.html }}
      />
    );
  }

  return (
    <div
      {...attributes}
      data-modern-distributed-ssr-reason={fragment?.reason ?? 'missing'}
      data-modern-distributed-ssr-status="degraded"
    >
      {fallback}
    </div>
  );
}

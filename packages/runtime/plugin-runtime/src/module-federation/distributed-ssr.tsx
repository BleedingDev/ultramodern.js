import type { ComponentType, ReactNode } from 'react';
import { useRuntimeContext } from '../core/context/runtime';

export const DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY =
  '__modernDistributedSsrFragments';
export const DISTRIBUTED_SSR_FRAGMENT_REQUEST_LOCALS_KEY =
  '__modernDistributedSsrFragmentRequest';

export type DistributedSsrFragment = {
  boundaryId: string;
  buildMarker?: string;
  digest?: string;
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

type DistributedSsrFragmentResult =
  | DistributedSsrFragment
  | DistributedSsrFragmentFailure;

export type DistributedSsrFragmentContext = {
  fragments?: Record<
    string,
    DistributedSsrFragment | DistributedSsrFragmentFailure
  >;
  required: true;
  resolve?: (
    remote: string,
    expose: string,
    props: Record<string, unknown>,
  ) => DistributedSsrFragmentResult | PromiseLike<DistributedSsrFragmentResult>;
};

export type DistributedSsrBoundaryProps<
  Props extends object = Record<string, unknown>,
> = {
  children: ReactNode;
  expose: string;
  fallback: ReactNode;
  fragmentProps?: Props;
  remote: string;
};

export type CreateDistributedSsrComponentOptions<Props extends object> = {
  createComponent: () => ComponentType<Props>;
  expose: string;
  fallback: ReactNode;
  remote: string;
};

export function distributedSsrFragmentKey(remote: string, expose: string) {
  return `${remote}::${expose}`;
}

function getDistributedSsrFragmentContext(
  response: { locals?: unknown } | undefined,
): DistributedSsrFragmentContext | undefined {
  const locals = response?.locals;
  if (typeof locals !== 'object' || locals === null) {
    return undefined;
  }

  const context =
    DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY in locals
      ? locals[DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY]
      : undefined;

  if (typeof context !== 'object' || context === null) {
    return undefined;
  }

  return context as DistributedSsrFragmentContext;
}

export function useDistributedSsrFragmentProps<Props extends object>({
  boundaryId,
  expose,
}: {
  boundaryId: string;
  expose: string;
}): Props {
  const runtimeContext = useRuntimeContext();
  const locals = runtimeContext.requestContext?.response?.locals;
  const request =
    typeof locals === 'object' &&
    locals !== null &&
    DISTRIBUTED_SSR_FRAGMENT_REQUEST_LOCALS_KEY in locals
      ? locals[DISTRIBUTED_SSR_FRAGMENT_REQUEST_LOCALS_KEY]
      : undefined;

  if (
    typeof request !== 'object' ||
    request === null ||
    !('boundaryId' in request) ||
    request.boundaryId !== boundaryId ||
    !('expose' in request) ||
    request.expose !== expose
  ) {
    throw new Error(
      `Distributed SSR fragment request contract mismatch for ${boundaryId} ${expose}.`,
    );
  }

  const props = 'props' in request ? request.props : undefined;
  if (typeof props !== 'object' || props === null || Array.isArray(props)) {
    throw new Error(
      `Distributed SSR fragment request props must be an object for ${boundaryId} ${expose}.`,
    );
  }

  return props as Props;
}

function isThenable(
  value:
    | DistributedSsrFragmentResult
    | PromiseLike<DistributedSsrFragmentResult>
    | undefined,
): value is PromiseLike<DistributedSsrFragmentResult> {
  return (
    value !== undefined && 'then' in value && typeof value.then === 'function'
  );
}

/**
 * Keeps the browser on the native Module Federation component while allowing
 * servers that cannot execute remote code (notably workerd) to render a
 * trusted fragment produced by the remote Worker itself.
 *
 * Node SSR has no distributed-fragment context and therefore renders the
 * child normally, preserving Module Federation's in-process SSR path.
 */
export function DistributedSsrBoundary<
  Props extends object = Record<string, unknown>,
>({
  children,
  expose,
  fallback,
  fragmentProps,
  remote,
}: DistributedSsrBoundaryProps<Props>) {
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
  if (fragmentContext === undefined) {
    return <div {...attributes}>{children}</div>;
  }

  const resolverFragmentProps =
    fragmentProps === undefined
      ? {}
      : Object.fromEntries(Object.entries(fragmentProps));
  const fragmentOrPromise =
    fragmentContext.resolve?.(remote, expose, resolverFragmentProps) ??
    fragmentContext.fragments?.[key];
  if (isThenable(fragmentOrPromise)) {
    throw fragmentOrPromise;
  }
  const fragment = fragmentOrPromise;
  if (fragment?.status === 'ready') {
    return (
      <div
        {...attributes}
        data-modern-distributed-ssr-build={fragment.buildMarker}
        data-modern-distributed-ssr-digest={fragment.digest}
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

/**
 * Defers creation of the native Module Federation component until React
 * actually renders that child. A workerd request with a verified distributed
 * fragment never constructs the native remote, so its module cannot perform
 * forbidden global-scope network I/O. Browser and Node rendering keep using
 * the native Module Federation component unchanged.
 */
export function createDistributedSsrComponent<Props extends object>({
  createComponent,
  expose,
  fallback,
  remote,
}: CreateDistributedSsrComponentOptions<Props>) {
  let RemoteComponent: ComponentType<Props> | undefined;

  function DeferredRemoteComponent(props: Props) {
    RemoteComponent ??= createComponent();
    return <RemoteComponent {...props} />;
  }

  return function DistributedSsrComponent(props: Props) {
    return (
      <DistributedSsrBoundary
        expose={expose}
        fallback={fallback}
        fragmentProps={props}
        remote={remote}
      >
        <DeferredRemoteComponent {...props} />
      </DistributedSsrBoundary>
    );
  };
}

import type { JSX } from '@solidjs/web';
import type { DeferredPromise } from '@tanstack/router-core';
import { defer, TSR_DEFERRED_PROMISE } from '@tanstack/router-core';
import * as Solid from 'solid-js';
import type { SolidNode } from './route';

export type AwaitOptions<T> = {
  promise: Promise<T>;
};

/**
 * Native loader data is frozen, and defer() tags the promise it tracks, so a
 * frozen promise is tracked through a follower that settles the same way.
 */
function track<T>(promise: Promise<T>): DeferredPromise<T> {
  return defer(Object.isExtensible(promise) ? promise : promise.then(v => v));
}

export function useAwaited<T>({
  promise: _promise,
}: AwaitOptions<T>): [data: T, promise: DeferredPromise<T>] {
  const promise = track(_promise);
  const data = Solid.createMemo(async () => await promise);

  return [data(), promise];
}

function InnerAwait<T>(props: {
  deferred: DeferredPromise<T>;
  ready: Solid.Accessor<unknown>;
  children: (res: T) => SolidNode;
}) {
  return (
    <Solid.Show when={props.ready()}>
      {_ => {
        const state = props.deferred[TSR_DEFERRED_PROMISE];
        if (state.status === 'error') {
          throw state.error;
        }
        return props.children(state.data as T) as any;
      }}
    </Solid.Show>
  );
}

export function Await<T>(
  props: AwaitOptions<T> & {
    fallback?: SolidNode;
    children: (result: T) => SolidNode;
  },
): JSX.Element {
  const deferred = track(props.promise);
  const ready = Solid.createMemo(async () => {
    await deferred;
    return true;
  });

  const inner = (
    <InnerAwait deferred={deferred} ready={ready}>
      {props.children}
    </InnerAwait>
  );

  if (props.fallback === undefined) {
    return inner;
  }

  return (
    <Solid.Loading fallback={props.fallback as any}>{inner}</Solid.Loading>
  );
}

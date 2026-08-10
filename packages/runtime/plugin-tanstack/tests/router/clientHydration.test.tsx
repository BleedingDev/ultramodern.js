import type { AnyRouter } from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import React, { Suspense } from 'react';
import { ModernRouterClient } from '../../src/runtime/clientHydration';
import { createTreeGetterFromFlightStream } from '../../src/runtime/rsc/treeGetter';

let hydrateImpl: () => Promise<unknown>;
let createFromReadableStreamImpl: () => Promise<unknown>;
let registeredCallServer: unknown;
let decoderCallServer: unknown;

rstest.mock('@tanstack/react-router', () => ({
  RouterProvider: ({ router }: { router: { label: string } }) => (
    <div data-testid="router-provider">{router.label}</div>
  ),
}));

rstest.mock('@tanstack/react-router/ssr/client', () => ({
  hydrate: () => hydrateImpl(),
}));

rstest.mock('@modern-js/runtime/rsc/client', () => {
  const callServer = () => undefined;

  return {
    callServer,
    createFromReadableStream: (
      _stream: ReadableStream<Uint8Array>,
      options: { callServer: unknown },
    ) => {
      decoderCallServer = options.callServer;
      return createFromReadableStreamImpl();
    },
    setServerCallback: (callback: unknown) => {
      registeredCallServer = callback;
    },
  };
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createRouter(label: string): AnyRouter {
  return {
    label,
    routesById: {},
    stores: {
      matches: {
        get: () => [],
      },
    },
  } as unknown as AnyRouter;
}

function FlightTree({ getTree }: { getTree: () => unknown }) {
  const tree = getTree();
  if (
    typeof tree !== 'object' ||
    tree === null ||
    !('label' in tree) ||
    typeof tree.label !== 'string'
  ) {
    throw new Error('Expected the decoded Flight tree to contain a label.');
  }
  return <div data-testid="flight-tree">{tree.label}</div>;
}

class FlightErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: (error: unknown) => void },
  { error: unknown }
> {
  state = { error: undefined };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  render() {
    if (this.state.error !== undefined) {
      return <div data-testid="flight-error">failed</div>;
    }
    return this.props.children;
  }
}

describe('TanStack SSR client hydration', () => {
  it('keeps the router behind Suspense until late SSR hydration completes', async () => {
    const hydration = createDeferred<void>();
    hydrateImpl = () => hydration.promise;

    render(
      <Suspense fallback={<div data-testid="hydrating">hydrating</div>}>
        <ModernRouterClient router={createRouter('inventory')} />
      </Suspense>,
    );

    expect(screen.getByTestId('hydrating')).toBeTruthy();
    expect(screen.queryByTestId('router-provider')).toBeNull();

    hydration.resolve();

    expect(
      (await screen.findByTestId('router-provider')).textContent,
    ).toContain('inventory');
    expect(screen.queryByTestId('hydrating')).toBeNull();
  });

  it('reuses one Flight decode while suspended and returns the resolved tree synchronously', async () => {
    const flight = createDeferred<unknown>();
    const decodeFlight = rstest.fn(() => flight.promise);
    createFromReadableStreamImpl = decodeFlight;
    registeredCallServer = undefined;
    decoderCallServer = undefined;

    const getTree = createTreeGetterFromFlightStream(
      new ReadableStream<Uint8Array>(),
    );
    const view = (
      <Suspense fallback={<div data-testid="flight-loading">loading</div>}>
        <FlightTree getTree={getTree} />
      </Suspense>
    );
    const { rerender } = render(view);

    expect(screen.getByTestId('flight-loading')).toBeTruthy();
    await waitFor(() => expect(decodeFlight).toHaveBeenCalledTimes(1));
    expect(registeredCallServer).toBe(decoderCallServer);

    await act(() => rerender(view));
    expect(screen.getByTestId('flight-loading')).toBeTruthy();
    expect(decodeFlight).toHaveBeenCalledTimes(1);

    const tree = { label: 'decoded inventory' };
    await act(async () => {
      flight.resolve(tree);
      await flight.promise;
    });

    expect((await screen.findByTestId('flight-tree')).textContent).toBe(
      tree.label,
    );
    expect(decodeFlight).toHaveBeenCalledTimes(1);
    expect(getTree()).toBe(tree);
  });

  it('preserves the original Flight decode rejection for the error boundary', async () => {
    const flight = createDeferred<unknown>();
    const failure = new Error('Flight decode failed');
    const decodeFlight = rstest.fn(() => flight.promise);
    createFromReadableStreamImpl = decodeFlight;
    let caughtError: unknown;
    const errorLog = rstest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const getTree = createTreeGetterFromFlightStream(
        new ReadableStream<Uint8Array>(),
      );
      await act(() =>
        render(
          <FlightErrorBoundary
            onError={error => {
              caughtError = error;
            }}
          >
            <Suspense
              fallback={<div data-testid="flight-loading">loading</div>}
            >
              <FlightTree getTree={getTree} />
            </Suspense>
          </FlightErrorBoundary>,
        ),
      );

      expect(screen.getByTestId('flight-loading')).toBeTruthy();
      await waitFor(() => expect(decodeFlight).toHaveBeenCalledTimes(1));
      await act(async () => {
        flight.reject(failure);
        await flight.promise.catch(() => undefined);
      });

      expect(await screen.findByTestId('flight-error')).toBeTruthy();
      expect(caughtError).toBe(failure);
    } finally {
      errorLog.mockRestore();
    }
  });
});

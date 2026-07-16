import { renderToString } from 'react-dom/server';
import { renderToReadableStream } from 'react-dom/server.edge';
import { RuntimeContext } from '../../src/core/context';
import {
  createDistributedSsrComponent,
  DISTRIBUTED_SSR_FRAGMENT_REQUEST_LOCALS_KEY,
  DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY,
  DistributedSsrBoundary,
  distributedSsrFragmentKey,
  useDistributedSsrFragmentProps,
} from '../../src/module-federation/distributed-ssr';

const key = distributedSsrFragmentKey('inventory', './Widget');

function renderBoundary(context: Record<string, unknown>) {
  return renderToString(
    <RuntimeContext.Provider value={context as never}>
      <DistributedSsrBoundary
        expose="./Widget"
        fallback={<p>unavailable</p>}
        remote="inventory"
      >
        <section data-native-mf="inventory">inventory</section>
      </DistributedSsrBoundary>
    </RuntimeContext.Provider>,
  );
}

describe('DistributedSsrBoundary', () => {
  it('keeps native Module Federation SSR on non-workerd servers', () => {
    const html = renderBoundary({
      isBrowser: false,
      requestContext: { request: {}, response: {} },
    });

    expect(html).toContain('data-native-mf="inventory"');
    expect(html).not.toContain('data-modern-distributed-ssr-status');
  });

  it('renders a verified Worker fragment without executing the child', () => {
    const html = renderBoundary({
      isBrowser: false,
      requestContext: {
        request: {},
        response: {
          locals: {
            [DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY]: {
              required: true,
              fragments: {
                [key]: {
                  boundaryId: 'verticalInventory',
                  expose: './Widget',
                  html: '<section data-modern-boundary-id="verticalInventory" data-modern-mf-expose="./Widget">SSR inventory</section>',
                  remote: 'inventory',
                  status: 'ready',
                },
              },
            },
          },
        },
      },
    });

    expect(html).toContain('SSR inventory');
    expect(html).toContain('data-modern-distributed-ssr-status="ready"');
    expect(html).not.toContain('data-native-mf');
  });

  it('renders the typed fallback when a required Worker fragment is degraded', () => {
    const html = renderBoundary({
      isBrowser: false,
      requestContext: {
        request: {},
        response: {
          locals: {
            [DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY]: {
              required: true,
              fragments: {
                [key]: {
                  boundaryId: 'verticalInventory',
                  expose: './Widget',
                  reason: 'binding-unavailable',
                  remote: 'inventory',
                  status: 'degraded',
                },
              },
            },
          },
        },
      },
    });

    expect(html).toContain('unavailable');
    expect(html).toContain('data-modern-distributed-ssr-status="degraded"');
    expect(html).toContain(
      'data-modern-distributed-ssr-reason="binding-unavailable"',
    );
  });
});

describe('useDistributedSsrFragmentProps', () => {
  it('returns only props verified for the rendered remote expose', () => {
    const Fragment = () => {
      const props = useDistributedSsrFragmentProps<{
        price: number;
        sku: string;
      }>({
        boundaryId: 'verticalCheckout',
        expose: './AddToCart',
      });

      return <output>{`${props.sku}:${props.price}`}</output>;
    };
    const html = renderToString(
      <RuntimeContext.Provider
        value={
          {
            isBrowser: false,
            requestContext: {
              request: {},
              response: {
                locals: {
                  [DISTRIBUTED_SSR_FRAGMENT_REQUEST_LOCALS_KEY]: {
                    boundaryId: 'verticalCheckout',
                    expose: './AddToCart',
                    props: { price: 7750, sku: 'CL-08-GR' },
                    remote: 'checkout',
                    sourceUrl:
                      'https://tractor.example.com/en/tractors/holland-hamster',
                  },
                },
              },
            },
          } as never
        }
      >
        <Fragment />
      </RuntimeContext.Provider>,
    );

    expect(html).toContain('CL-08-GR:7750');
  });

  it('rejects a fragment request for a different expose', () => {
    const Fragment = () => {
      useDistributedSsrFragmentProps({
        boundaryId: 'verticalCheckout',
        expose: './MiniCart',
      });
      return null;
    };

    expect(() =>
      renderToString(
        <RuntimeContext.Provider
          value={
            {
              isBrowser: false,
              requestContext: {
                request: {},
                response: {
                  locals: {
                    [DISTRIBUTED_SSR_FRAGMENT_REQUEST_LOCALS_KEY]: {
                      boundaryId: 'verticalCheckout',
                      expose: './AddToCart',
                      props: {},
                      remote: 'checkout',
                      sourceUrl: 'https://tractor.example.com/en/cart',
                    },
                  },
                },
              },
            } as never
          }
        >
          <Fragment />
        </RuntimeContext.Provider>,
      ),
    ).toThrow(/fragment request contract mismatch/u);
  });
});

describe('createDistributedSsrComponent', () => {
  it('suspends workerd SSR until an asynchronous service fragment is ready', async () => {
    const fragment = {
      boundaryId: 'verticalCheckout',
      expose: './AddToCart',
      html: '<button>Add asynchronous tractor</button>',
      remote: 'checkout',
      status: 'ready' as const,
    };
    let resolved = false;
    let pending: Promise<typeof fragment> | undefined;
    const Remote = createDistributedSsrComponent<{ sku: string }>({
      createComponent: () => () => (
        <section data-native-mf="checkout">native checkout</section>
      ),
      expose: './AddToCart',
      fallback: <p>unavailable</p>,
      remote: 'checkout',
    });
    const stream = await renderToReadableStream(
      <RuntimeContext.Provider
        value={
          {
            isBrowser: false,
            requestContext: {
              request: {},
              response: {
                locals: {
                  [DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY]: {
                    required: true,
                    resolve: () => {
                      if (resolved) {
                        return fragment;
                      }
                      pending ??= Promise.resolve(fragment).then(value => {
                        resolved = true;
                        return value;
                      });
                      return pending;
                    },
                  },
                },
              },
            },
          } as never
        }
      >
        <Remote sku="CL-08-GR" />
      </RuntimeContext.Provider>,
    );
    await stream.allReady;
    const html = await new Response(stream).text();

    expect(html).toContain('Add asynchronous tractor');
    expect(html).not.toContain('unavailable');
    expect(html).not.toContain('data-native-mf');
  });

  it('resolves a workerd fragment from the actual serializable component props', () => {
    const requests: Array<{
      expose: string;
      props: Record<string, unknown>;
      remote: string;
    }> = [];
    const Remote = createDistributedSsrComponent<{
      price: number;
      sku: string;
    }>({
      createComponent: () => () => (
        <section data-native-mf="inventory">native inventory</section>
      ),
      expose: './AddToCart',
      fallback: <p>unavailable</p>,
      remote: 'checkout',
    });
    const html = renderToString(
      <RuntimeContext.Provider
        value={
          {
            isBrowser: false,
            requestContext: {
              request: {},
              response: {
                locals: {
                  [DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY]: {
                    required: true,
                    resolve: (
                      remote: string,
                      expose: string,
                      props: Record<string, unknown>,
                    ) => {
                      requests.push({ expose, props, remote });
                      return {
                        boundaryId: 'verticalCheckout',
                        buildMarker: 'checkout-build-b',
                        digest: 'sha256-checkout-b',
                        expose,
                        html: '<button>Add Holland Hamster</button><output>7750</output>',
                        remote,
                        status: 'ready',
                      };
                    },
                  },
                },
              },
            },
          } as never
        }
      >
        <Remote price={7750} sku="CL-08-GR" />
      </RuntimeContext.Provider>,
    );

    expect(requests).toEqual([
      {
        expose: './AddToCart',
        props: { price: 7750, sku: 'CL-08-GR' },
        remote: 'checkout',
      },
    ]);
    expect(html).toContain(
      '<button>Add Holland Hamster</button><output>7750</output>',
    );
    expect(html).toContain(
      'data-modern-distributed-ssr-build="checkout-build-b"',
    );
    expect(html).toContain(
      'data-modern-distributed-ssr-digest="sha256-checkout-b"',
    );
    expect(html).not.toContain('data-native-mf');
  });

  it('does not construct the native remote when workerd has a verified fragment', () => {
    let nativeRemoteCreations = 0;
    const Remote = createDistributedSsrComponent({
      createComponent: () => {
        nativeRemoteCreations += 1;
        return () => <section data-native-mf="inventory">inventory</section>;
      },
      expose: './Widget',
      fallback: <p>unavailable</p>,
      remote: 'inventory',
    });
    const html = renderToString(
      <RuntimeContext.Provider
        value={
          {
            isBrowser: false,
            requestContext: {
              request: {},
              response: {
                locals: {
                  [DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY]: {
                    required: true,
                    fragments: {
                      [key]: {
                        boundaryId: 'verticalInventory',
                        expose: './Widget',
                        html: '<section data-modern-boundary-id="verticalInventory" data-modern-mf-expose="./Widget">SSR inventory</section>',
                        remote: 'inventory',
                        status: 'ready',
                      },
                    },
                  },
                },
              },
            },
          } as never
        }
      >
        <Remote />
      </RuntimeContext.Provider>,
    );

    expect(html).toContain('SSR inventory');
    expect(nativeRemoteCreations).toBe(0);
  });

  it('constructs and caches the native remote for Node SSR', () => {
    let nativeRemoteCreations = 0;
    const Remote = createDistributedSsrComponent({
      createComponent: () => {
        nativeRemoteCreations += 1;
        return () => <section data-native-mf="inventory">inventory</section>;
      },
      expose: './Widget',
      fallback: <p>unavailable</p>,
      remote: 'inventory',
    });
    const context = {
      isBrowser: false,
      requestContext: { request: {}, response: {} },
    } as never;

    expect(
      renderToString(
        <RuntimeContext.Provider value={context}>
          <Remote />
        </RuntimeContext.Provider>,
      ),
    ).toContain('data-native-mf="inventory"');
    renderToString(
      <RuntimeContext.Provider value={context}>
        <Remote />
      </RuntimeContext.Provider>,
    );

    expect(nativeRemoteCreations).toBe(1);
  });
});

import { renderToString } from 'react-dom/server';
import { RuntimeContext } from '../../src/core/context';
import {
  createDistributedSsrComponent,
  DISTRIBUTED_SSR_FRAGMENTS_LOCALS_KEY,
  DistributedSsrBoundary,
  distributedSsrFragmentKey,
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

describe('createDistributedSsrComponent', () => {
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

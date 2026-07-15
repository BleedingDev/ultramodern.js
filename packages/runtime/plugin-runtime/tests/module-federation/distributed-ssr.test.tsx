import { renderToString } from 'react-dom/server';
import { RuntimeContext } from '../../src/core/context';
import {
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

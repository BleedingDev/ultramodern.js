import { createRouteHydrationScriptTags } from '../../../src/core/server/scriptOrder';
import { applyRouterRuntimeState } from '../../../src/router/runtime/lifecycle';

describe('route hydration script serialization', () => {
  it('quotes and escapes asset and nonce attributes', () => {
    const runtimeContext = {} as any;
    applyRouterRuntimeState(runtimeContext, {
      framework: 'react-router',
      serverSnapshot: { matchedRouteIds: ['route-a'] },
    });
    runtimeContext.routeManifest = {
      routeAssets: {
        'route-a': {
          assets: ['/route" onload="alert(1)&x=<tag>.js'],
        },
      },
    };

    expect(
      createRouteHydrationScriptTags(runtimeContext, 'main', {
        nonce: 'nonce"&<value>',
      }),
    ).toBe(
      '<script src="/route&quot; onload=&quot;alert(1)&amp;x=&lt;tag&gt;.js" nonce="nonce&quot;&amp;&lt;value&gt;"></script>',
    );
  });
});

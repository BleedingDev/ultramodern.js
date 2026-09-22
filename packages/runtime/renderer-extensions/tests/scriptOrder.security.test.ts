import { createRouteHydrationScriptTags as createTags } from '@modern-js/runtime-extensions';
import {
  applyRouterServerPrepareResult,
  getRouterMatchedRouteIds,
} from '@modern-js/runtime-extensions/router-state';

const createRouteHydrationScriptTags = (
  context: any,
  entryName: string,
  options: any,
) =>
  createTags(
    context.routeManifest,
    getRouterMatchedRouteIds(context) ?? [],
    entryName,
    options,
  );

describe('route hydration script serialization', () => {
  it('quotes and escapes asset and nonce attributes', () => {
    const runtimeContext = {} as any;
    applyRouterServerPrepareResult(runtimeContext, {
      state: { framework: 'react-router' },
      snapshot: { matchedRouteIds: ['route-a'] },
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

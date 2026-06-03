import React from 'react';
import { RenderLevel } from '../../../src/core/constants';
import { setGlobalInternalRuntimeContext } from '../../../src/core/context';
import { renderString } from '../../../src/core/server/string';
import { Helmet } from '../../../src/exports/head';

describe('renderString', () => {
  it('collects helmet data without falling back to client render', async () => {
    const onErrorCalls: unknown[][] = [];
    const runtimeContext = {
      isBrowser: false,
      requestContext: {},
      context: {},
      initialData: {},
      __i18nData__: {},
      ssrContext: {
        request: {
          params: {},
          query: {},
          pathname: '/',
          host: 'localhost',
          url: 'http://localhost/',
          headers: {},
        },
        reporter: { sessionId: 'session-1' },
      },
    };

    setGlobalInternalRuntimeContext({
      hooks: {
        extendStringSSRCollectors: {
          call: () => [],
        },
      },
    } as any);

    const html = await renderString(
      new Request('http://localhost/'),
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          Helmet,
          null,
          React.createElement('title', null, 'Server Title'),
        ),
        React.createElement('main', null, 'SSR body'),
      ),
      {
        resource: {
          entryName: 'main',
          htmlTemplate:
            '<html><head><title>Default</title><!--<?- chunksMap.css ?>--></head><body><div id="root"><!--<?- html ?>--></div><!--<?- SSRDataScript ?>--><!--<?- chunksMap.js ?>--></body></html>',
          routeManifest: {},
        },
        runtimeContext,
        config: {},
        onError: (...args: unknown[]) => {
          onErrorCalls.push(args);
        },
        onTiming: () => {},
      } as any,
    );

    expect(onErrorCalls).toHaveLength(0);
    expect(html).toContain('<title data-rh="true">Server Title</title>');
    expect(html).toContain('SSR body');
    expect(html).toContain(`"renderLevel":${RenderLevel.SERVER_RENDER}`);
  });
});

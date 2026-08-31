import React from 'react';
import { setGlobalInternalRuntimeContext } from '../../../../src/core/context';
import { renderStreaming } from '../../../../src/core/server/stream';
import { Helmet } from '../../../../src/exports/head';

const createRuntimeContext = () => ({
  isBrowser: false,
  requestContext: {},
  context: {},
  initialData: {},
  __i18nData__: {},
  routeManifest: {},
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
});

describe('streaming Helmet collection', () => {
  it('publishes only Helmet markers present in the completed shell', async () => {
    setGlobalInternalRuntimeContext({
      hooks: {
        extendStreamSSR: {
          call: () => [],
        },
      },
    } as any);

    const AbandonPrimary = (): null => {
      throw new Error('abandon primary');
    };
    const runtimeContext = createRuntimeContext();
    const stream = await renderStreaming(
      new Request('http://localhost/'),
      <>
        <Helmet>
          <meta name="outside" content="committed" />
        </Helmet>
        <React.Suspense
          fallback={
            <>
              <Helmet>
                <meta name="fallback" content="committed" />
              </Helmet>
              fallback rendered
            </>
          }
        >
          <Helmet>
            <meta name="abandoned-unique" content="ghost" />
          </Helmet>
          <AbandonPrimary />
        </React.Suspense>
      </>,
      {
        resource: {
          entryName: 'index',
          htmlTemplate:
            '<html><head></head><body><!--<?- html ?>--></body></html>',
          routeManifest: {},
        },
        runtimeContext,
        config: {},
        onError: () => {},
        onTiming: () => {},
      } as any,
    );

    const html = await new Response(stream).text();
    expect(html).toContain('name="outside" content="committed"');
    expect(html).toContain('name="fallback" content="committed"');
    expect(html).not.toContain('abandoned-unique');
    expect(html).not.toContain('data-modern-helmet');
  });
});

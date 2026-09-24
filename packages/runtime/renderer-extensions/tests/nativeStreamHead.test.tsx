import React from 'react';
import { registerPlugin } from '../../plugin-runtime/src/core/plugin';
import { renderStreaming } from '../../plugin-runtime/src/core/server/stream';
import { Helmet } from '../../plugin-runtime/src/exports/head';
import { rendererHeadPlugin } from '../src/node';

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

const renderDocument = async (root: React.ReactElement) => {
  registerPlugin([rendererHeadPlugin()]);
  const stream = await renderStreaming(new Request('http://localhost/'), root, {
    resource: {
      entryName: 'index',
      htmlTemplate: '<html><head></head><body><!--<?- html ?>--></body></html>',
      routeManifest: {},
    },
    runtimeContext: createRuntimeContext(),
    config: {},
    onError: () => {},
    onTiming: () => {},
  } as any);
  return new Response(stream).text();
};

describe('streaming Helmet collection', () => {
  it('publishes only Helmet markers present in the completed shell', async () => {
    const AbandonPrimary = (): null => {
      throw new Error('abandon primary');
    };
    const html = await renderDocument(
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
    );

    expect(html).toContain('name="outside" content="committed"');
    expect(html).toContain('name="fallback" content="committed"');
    expect(html).not.toContain('abandoned-unique');
    expect(html).not.toContain('data-modern-helmet');
  });

  it('keeps the head of a large completed route boundary in the shell', async () => {
    // Routes render inside Suspense below the app container. A completed
    // boundary this large is one React would otherwise write after the shell,
    // past the point where the document head is sealed.
    const html = await renderDocument(
      <div id="app">
        <React.Suspense fallback="loading">
          <main>{'Route content. '.repeat(1000)}</main>
          <Helmet htmlAttributes={{ lang: 'cs' }}>
            <title>Route title</title>
            <meta name="description" content="Route description" />
          </Helmet>
        </React.Suspense>
      </div>,
    );

    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('<html lang="cs">');
    expect(head).toMatch(/<title[^>]*>Route title<\/title>/);
    expect(head).toMatch(
      /<meta(?=[^>]*name="description")(?=[^>]*content="Route description")/,
    );
    expect(html).toContain('<main>Route content. ');
  });
});

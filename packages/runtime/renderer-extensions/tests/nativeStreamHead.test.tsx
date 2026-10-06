import { LATE_HEAD_MESSAGE } from '@modern-js/runtime-extensions';
import React from 'react';
import { storage } from '../../../toolkit/runtime-utils/src/node';
import { defaultMonitors } from '../../plugin-runtime/src/core/context/monitors/default';
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

const renderDocument = async (
  root: React.ReactElement,
  {
    headers = {},
    onShell,
  }: { headers?: Record<string, string>; onShell?: () => void } = {},
) => {
  registerPlugin([rendererHeadPlugin()]);
  return storage.run({}, async () => {
    const stream = await renderStreaming(
      new Request('http://localhost/', { headers }),
      root,
      {
        resource: {
          entryName: 'index',
          htmlTemplate:
            '<html><head></head><body><!--<?- html ?>--></body></html>',
          routeManifest: {},
        },
        runtimeContext: createRuntimeContext(),
        config: {},
        onError: () => {},
        onTiming: () => {},
      } as any,
    );
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let html = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return html;
      if (html === '') onShell?.();
      html += value;
    }
  });
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

  describe('a Helmet in a boundary that completes after the shell', () => {
    const createLateTree = () => {
      let resolve!: () => void;
      const ready = new Promise<void>(done => {
        resolve = done;
      });
      let settled = false;
      ready.then(() => {
        settled = true;
      });
      const Late = () => {
        if (!settled) throw ready;
        return (
          <Helmet>
            <title>Late title</title>
          </Helmet>
        );
      };
      // A root-level Suspense could hold the document preamble, so React
      // would wait for it; apps render routes inside a container.
      const tree = (
        <div id="app">
          <Helmet>
            <meta name="shell" content="committed" />
          </Helmet>
          <React.Suspense fallback="loading">
            <Late />
          </React.Suspense>
        </div>
      );
      return { tree, resolve };
    };

    afterEach(() => {
      rstest.restoreAllMocks();
    });

    it('reports the dropped head tags', async () => {
      const error = rstest
        .spyOn(defaultMonitors, 'error')
        .mockImplementation(() => {});
      const { tree, resolve } = createLateTree();
      const html = await renderDocument(tree, { onShell: resolve });

      const head = html.slice(0, html.indexOf('</head>'));
      expect(head).toContain('name="shell" content="committed"');
      expect(html).toContain('loading');
      expect(head).not.toContain('Late title');
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(LATE_HEAD_MESSAGE);
      expect(LATE_HEAD_MESSAGE).toContain('<Helmet>');
    });

    it('gives a bot the full head', async () => {
      const error = rstest.spyOn(defaultMonitors, 'error');
      const warn = rstest.spyOn(defaultMonitors, 'warn');
      const { tree, resolve } = createLateTree();
      setTimeout(resolve, 0);
      const html = await renderDocument(tree, {
        headers: { 'user-agent': 'Googlebot/2.1' },
      });

      const head = html.slice(0, html.indexOf('</head>'));
      expect(head).toContain('name="shell" content="committed"');
      expect(head).toMatch(/<title[^>]*>Late title<\/title>/);
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

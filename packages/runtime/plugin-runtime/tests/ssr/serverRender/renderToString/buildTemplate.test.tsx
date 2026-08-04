import React from 'react';
import { setGlobalInternalRuntimeContext } from '../../../../src/core/context';
import { SSR_DATA_PLACEHOLDER } from '../../../../src/core/server/constants';
import { renderString } from '../../../../src/core/server/string';
import { applyRouterRuntimeState } from '../../../../src/router/runtime/lifecycle';

const TSR_BOOTSTRAP = '<script>window.$_TSR = { router: "hydrated" };</script>';

const createRuntimeContext = (options: { withRouterBootstrap: boolean }) => {
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

  if (options.withRouterBootstrap) {
    applyRouterRuntimeState(runtimeContext as any, {
      framework: 'react-router',
      serverSnapshot: {
        hydrationScripts: [TSR_BOOTSTRAP],
      },
    });
  }

  return runtimeContext;
};

const render = async (
  htmlTemplate: string,
  options: { entryName?: string; withRouterBootstrap?: boolean } = {},
) => {
  setGlobalInternalRuntimeContext({
    hooks: {
      extendStringSSRCollectors: {
        call: () => [],
      },
    },
  } as any);

  return renderString(
    new Request('http://localhost/'),
    React.createElement('main', null, 'server markup'),
    {
      resource: {
        entryName: options.entryName ?? 'index',
        htmlTemplate,
        routeManifest: {},
      },
      runtimeContext: createRuntimeContext({
        withRouterBootstrap: options.withRouterBootstrap ?? true,
      }),
      config: {},
      onError: () => {},
      onTiming: () => {},
    } as any,
  );
};

describe('renderString template assembly (string-mode script ordering)', () => {
  it('should emit the SSR data + router bootstrap before the entry script', async () => {
    const html = await render(
      [
        '<html><head>',
        '<script src="/static/js/index.js" async></script>',
        '<!--<?- chunksMap.css ?>-->',
        '</head><body><div id="root">',
        '<!--<?- html ?>-->',
        '</div>',
        '<!--<?- chunksMap.js ?>-->',
        SSR_DATA_PLACEHOLDER,
        '</body></html>',
      ].join(''),
    );

    const entryIndex = html.indexOf(
      '<script src="/static/js/index.js" async></script>',
    );
    const ssrDataIndex = html.indexOf('window._SSR_DATA =');
    const routerBootstrapIndex = html.indexOf('window.$_TSR =');

    expect(ssrDataIndex).toBeGreaterThan(-1);
    expect(routerBootstrapIndex).toBeGreaterThan(ssrDataIndex);
    expect(entryIndex).toBeGreaterThan(routerBootstrapIndex);
    expect(html).not.toContain(SSR_DATA_PLACEHOLDER);
  });

  it('should keep the async entry variant ordered after the bootstrap', async () => {
    const html = await render(
      [
        '<html><head>',
        '<script async src="/static/js/async-index.js"></script>',
        '</head><body><div id="root">',
        '<!--<?- html ?>-->',
        '</div>',
        SSR_DATA_PLACEHOLDER,
        '</body></html>',
      ].join(''),
    );

    const entryIndex = html.indexOf(
      '<script async src="/static/js/async-index.js"></script>',
    );
    const routerBootstrapIndex = html.indexOf('window.$_TSR =');

    expect(routerBootstrapIndex).toBeGreaterThan(-1);
    expect(entryIndex).toBeGreaterThan(routerBootstrapIndex);
  });

  it('should fall back to in-place replacement when no entry script tag exists', async () => {
    const html = await render(
      [
        '<html><head></head><body><div id="root">',
        '<!--<?- html ?>-->',
        '</div>',
        '<span id="marker"></span>',
        SSR_DATA_PLACEHOLDER,
        '</body></html>',
      ].join(''),
    );

    const markerIndex = html.indexOf('<span id="marker"></span>');
    const ssrDataIndex = html.indexOf('window._SSR_DATA =');

    expect(markerIndex).toBeGreaterThan(-1);
    expect(ssrDataIndex).toBeGreaterThan(markerIndex);
    expect(html).not.toContain(SSR_DATA_PLACEHOLDER);
  });
});

export const cloudflareWorkerSources = {
  main: `module.exports = { requestHandler: async (request, options) => new Response(JSON.stringify({
      pathname: new URL(request.url).pathname,
      entryName: options.resource.entryName,
      htmlTemplate: options.resource.htmlTemplate,
      routeAssetKeys: Object.keys(options.resource.routeManifest.routeAssets || {}),
      loadableName: options.resource.loadableStats.name
    }), { headers: { 'content-type': 'application/json' } }) };`,
  empty: 'module.exports = {};',
  dirname: `module.exports = { requestHandler: async () => new Response(JSON.stringify({
      dirname: __dirname,
      filename: __filename
    }), { headers: { 'content-type': 'application/json' } }) };`,
  html: `module.exports = { requestHandler: async () => new Response('<!doctype html><html><head><title>styled</title></head><body><header data-modern-boundary-id="explore" data-modern-mf-expose="./Header">Header</header><main data-modern-boundary-id="checkout" data-modern-mf-expose="./CartPage">Cart</main></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) };`,
  head: `module.exports = { requestHandler: async request => {
      if (request.method !== 'GET') {
        return new Response('unexpected method', { status: 500 });
      }

      return new Response('<!doctype html><html><head><title>head</title></head><body>ok</body></html>', {
        headers: {
          'content-length': '77',
          'content-type': 'text/html; charset=utf-8',
          'x-render-method': request.method
        }
      });
    } };`,
  promiseDefault: `module.exports = { default: {
      requestHandler: Promise.resolve(async (request, options) => new Response(JSON.stringify({
        pathname: new URL(request.url).pathname,
        source: 'promised-default',
        entryName: options.resource.entryName,
        htmlTemplate: options.resource.htmlTemplate
      }), { headers: { 'content-type': 'application/json' } }))
    } };`,
  bundleFallback: `module.exports = {
      requestHandler: async (request, options) => new Response(JSON.stringify({
        pathname: new URL(request.url).pathname,
        source: 'bundle-fallback',
        entryName: options.resource.entryName,
        htmlTemplate: options.resource.htmlTemplate
      }), { headers: { 'content-type': 'application/json' } })
    };`,
  effectBff: `module.exports = { default: {
      handler: async (request, context) => new Response(JSON.stringify({
          pathname: new URL(request.url).pathname,
          originalPath: context.path,
          method: context.method,
          envValue: context.env.TEST_VALUE
        }), { headers: { 'content-type': 'application/json' } }),
      dispose: async () => {}
    } };`,
} as const;

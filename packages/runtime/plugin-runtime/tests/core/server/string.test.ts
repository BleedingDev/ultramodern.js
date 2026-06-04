import { injectBeforeHydrationEntryScript } from '../../../src/core/server/scriptOrder';

const scriptSrcs = (html: string) =>
  Array.from(html.matchAll(/<script\b[^>]*\bsrc=(["'])(.*?)\1[^>]*>/g)).map(
    match => match[2],
  );

describe('string SSR script ordering', () => {
  it('injects hydration route scripts before the entry bootstrap', () => {
    const html = injectBeforeHydrationEntryScript(
      '<head><script defer src="/static/js/index.abc.js"></script></head>',
      '<script defer src="/static/js/async/(lang)/page.js"></script>',
      'index',
    );

    expect(scriptSrcs(html)).toEqual([
      '/static/js/async/(lang)/page.js',
      '/static/js/index.abc.js',
    ]);
  });

  it('falls back to the async entry when the bootstrap script is absent', () => {
    const html = injectBeforeHydrationEntryScript(
      '<body><script defer src="/static/js/async/async-index.js"></script></body>',
      '<script defer src="/static/js/async/(lang)/page.js"></script>',
      'index',
    );

    expect(scriptSrcs(html)).toEqual([
      '/static/js/async/(lang)/page.js',
      '/static/js/async/async-index.js',
    ]);
  });
});

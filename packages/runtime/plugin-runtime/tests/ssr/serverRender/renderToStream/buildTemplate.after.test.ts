import { RenderLevel } from '../../../../src/ssr/serverRender/types';
import { buildShellAfterTemplate } from '../../../../src/ssr/serverRender/renderToStream/buildTemplate.after';

describe('buildShellAfterTemplate', () => {
  it('should strip denylisted headers from streaming SSR data script', () => {
    const html = buildShellAfterTemplate('<!--<?- SSRDataScript ?>-->', {
      context: {
        initialData: {},
        __i18nData__: {},
        ssrContext: {
          enableUnsafeCtx: true,
          request: {
            params: {},
            query: {},
            pathname: '/',
            host: 'localhost',
            url: 'http://localhost/',
            headers: {
              authorization: 'Bearer secret',
              cookie: 'sid=abc',
              'x-request-id': 'req-1',
              'x-internal-secret': 'hidden',
            },
          },
          tracker: { sessionId: 'session-1' },
          unsafeHeaders: ['x-internal-secret'],
        },
      } as any,
      renderLevel: RenderLevel.SERVER_RENDER,
    });

    expect(html).toMatch('"x-request-id":"req-1"');
    expect(html).not.toMatch('authorization');
    expect(html).not.toMatch('cookie');
    expect(html).not.toMatch('x-internal-secret');
  });
});

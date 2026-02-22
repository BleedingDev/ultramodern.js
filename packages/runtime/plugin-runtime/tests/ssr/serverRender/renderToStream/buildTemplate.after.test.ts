import { RenderLevel } from '../../../../src/core/constants';
import { SSRDataCollector } from '../../../../src/core/server/string/ssrData';

describe('SSRDataCollector (stream parity)', () => {
  it('should strip denylisted headers from serialized SSR data script', () => {
    const chunkSet = {
      renderLevel: RenderLevel.SERVER_RENDER,
      ssrScripts: '',
      jsChunk: '',
      cssChunk: '',
    };

    const collector = new SSRDataCollector({
      runtimeContext: {
        initialData: {},
        __i18nData__: {},
      } as any,
      request: new Request('http://localhost/'),
      chunkSet,
      ssrContext: {
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
        reporter: { sessionId: 'session-1' },
      } as any,
      ssrConfig: {
        unsafeHeaders: ['x-request-id'],
      } as any,
    });

    collector.effect();

    expect(chunkSet.ssrScripts).toMatch('"x-request-id":"req-1"');
    expect(chunkSet.ssrScripts).not.toMatch('authorization');
    expect(chunkSet.ssrScripts).not.toMatch('cookie');
    expect(chunkSet.ssrScripts).not.toMatch('x-internal-secret');
  });
});
